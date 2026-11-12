// Handlers de /api/settings (preferences GET/PUT, notifications GET/PUT, notifications/device POST) contra o fake em memória.
// Cenários: docs/testing/endpoint-scenarios-g3.md, seção 2 (SET-xx). Padrão: tests/fast/taxes/handlers.test.ts.
//  - Settings é por USUÁRIO (user_id da sessão), não por organização (KF-22 é desenho legítimo). Isolamento = entre usuários.
//  - 401 sem sessão já é provado por guard-matrix.test.ts; não se repete aqui.
//  - it.fails = comportamento correto ainda não implementado (ver docs/testing/known-failures.md, KF-73 a KF-75).
//    Ao corrigir o handler o Vitest acusa "unexpected pass": troque it.fails por it.
//  - Limitações do fake:
//      * `upsert()` ignora `onConflict`: sempre INSERE uma linha nova (sem constraint única). Idempotência real do
//        upsert (1 linha por usuário) NÃO é provável aqui (SET-07 prova só user_id/valor dos writes; contagem = it.todo).
//      * `select(cols)` ignora a lista de colunas e devolve a linha inteira (inclui id e user_id). Logo "habit_reminders
//        sempre true" só é provado para linha SEM a coluna; o select real do handler omite a coluna (G3-SD-05).
//      * `failNext` falha a PRÓXIMA consulta da tabela. Em SET-05/12 é o select; em SET-18 é o upsert (nenhuma consulta
//        anterior à mesma tabela no PUT).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, installNitroGlobals, installServerUtilsGlobals, callHandler } from '../../support/handler-harness'
import { createFakeSupabase, type FakeSupabase } from '../../support/fake-supabase'

let fake: FakeSupabase
const auth = { getUser: vi.fn(), refreshSession: vi.fn() }

vi.mock('../../../server/utils/supabase', () => ({ getSupabaseAdminClient: () => fake.client }))
vi.mock('../../../server/utils/supabase-anon', () => ({ getSupabaseAnonClient: () => ({ auth }) }))
vi.mock('stripe', () => ({ default: class {} }))

installNitroGlobals()
await installServerUtilsGlobals()

const cookies = { 'sb-access-token': 'tok' }
const PREF_GET = 'server/api/settings/preferences.get.ts'
const PREF_PUT = 'server/api/settings/preferences.put.ts'
const NOTIF_GET = 'server/api/settings/notifications.get.ts'
const NOTIF_PUT = 'server/api/settings/notifications.put.ts'
const DEVICE = 'server/api/settings/notifications/device.post.ts'

type Persona = 'u1' | 'u2'
const USERS: Record<Persona, { id: string, email: string }> = {
  u1: { id: 'u-1', email: 'u1@a.com' },
  u2: { id: 'u-2', email: 'u2@b.com' }
}

function loginAs(persona: Persona) {
  const u = USERS[persona]
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: u.id, email: u.email } }, error: null })
}

const DEFAULT_PREFS = { primary_color: 'purple', neutral_color: 'slate', color_mode: 'light', timezone: 'UTC' }
const DEFAULT_NOTIF = {
  channel_in_app: true,
  channel_email: true,
  channel_web_push: false,
  channel_mobile_push: false,
  habit_reminders: true,
  weekly_digest: false,
  product_updates: true,
  important_updates: true,
  web_push_permission: 'default',
  mobile_push_permission: 'default',
  subscriptions: []
}

// Seed: U1 e U2 sem linhas (cada teste semeia o que precisa). U2 recebe linhas "marcadoras" em seedBoth().
function seed() {
  fake = createFakeSupabase({ user_preferences: [], notification_preferences: [] })
}

function seedBoth() {
  fake.tables.user_preferences!.push(
    { user_id: 'u-1', primary_color: 'blue', neutral_color: 'zinc', color_mode: 'dark', timezone: 'America/Sao_Paulo' },
    { user_id: 'u-2', primary_color: 'red', neutral_color: 'stone', color_mode: 'light', timezone: 'Europe/Lisbon' }
  )
  fake.tables.notification_preferences!.push(
    { user_id: 'u-1', channel_email: false, weekly_digest: true },
    { user_id: 'u-2', channel_email: true, weekly_digest: false, channel_web_push: true }
  )
}

beforeEach(() => {
  seed()
  loginAs('u1')
  auth.refreshSession.mockReset()
})

const prefRows = () => fake.tables.user_preferences!
const notifRows = () => fake.tables.notification_preferences!
const writesOf = (table: string) => fake.writes.filter(w => w.table === table)
const getPrefs = (query: Record<string, unknown> = {}) => callHandler(PREF_GET, fakeEvent({ cookies, query }))
const putPrefs = (body: unknown) => callHandler(PREF_PUT, fakeEvent({ method: 'PUT', cookies, body }))
const getNotif = (query: Record<string, unknown> = {}) => callHandler(NOTIF_GET, fakeEvent({ cookies, query }))
const putNotif = (body: unknown) => callHandler(NOTIF_PUT, fakeEvent({ method: 'PUT', cookies, body }))
const postDevice = (body?: unknown) => callHandler(DEVICE, fakeEvent({ method: 'POST', cookies, body }))
type Obj = Record<string, any>

describe('SET-03: GET preferences defaults and merge', () => {
  it('no row -> defaults (purple, slate, light, UTC); GET creates nothing', async () => {
    const res = await getPrefs()
    expect(res.status).toBe(200)
    expect(res.body).toEqual(DEFAULT_PREFS)
    expect(fake.writes).toHaveLength(0)
    expect(prefRows()).toHaveLength(0)
  })

  it('partial row -> saved values merged over defaults', async () => {
    prefRows().push({ user_id: 'u-1', primary_color: 'blue' })
    const res = await getPrefs()
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ...DEFAULT_PREFS, primary_color: 'blue' })
    expect(fake.writes).toHaveLength(0)
  })
})

describe('SET-04: GET preferences isolation between users (user_id from the session)', () => {
  it('logged in as U1 with ?user_id=u-2 -> only U1 data', async () => {
    seedBoth()
    const res = await getPrefs({ user_id: 'u-2' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ primary_color: 'blue', neutral_color: 'zinc', color_mode: 'dark', timezone: 'America/Sao_Paulo' })
    expect(JSON.stringify(res.body)).not.toContain('Lisbon')
    expect(JSON.stringify(res.body)).not.toContain('red')
  })
})

describe('SET-05: GET preferences query error', () => {
  it('select fails -> 500 "Failed to fetch user preferences" without internal detail', async () => {
    fake.failNext('user_preferences', 'relation secret_internal_detail exploded')
    const res = await getPrefs()
    expect(res.status).toBe(500)
    expect(res.error?.statusMessage).toBe('Failed to fetch user preferences')
    expect(res.error?.message).not.toContain('secret_internal_detail')
    expect(res.body).toBeUndefined()
  })
})

describe('SET-06: PUT preferences without row', () => {
  it('{primary_color, color_mode} -> 200 with payload; one upsert for U1; omitted get defaults', async () => {
    const res = await putPrefs({ primary_color: 'blue', color_mode: 'dark' })
    expect(res.status).toBe(200)
    const expected = { user_id: 'u-1', primary_color: 'blue', neutral_color: 'slate', color_mode: 'dark', timezone: 'UTC' }
    expect(res.body).toEqual(expected)
    const writes = writesOf('user_preferences')
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ op: 'upsert', values: expected })
    expect(prefRows()).toHaveLength(1)
  })
})

describe('SET-07: PUT preferences twice', () => {
  it('second PUT upserts the new value for the same user_id (row count NOT provable: fake ignores onConflict)', async () => {
    await putPrefs({ primary_color: 'blue' })
    const res = await putPrefs({ primary_color: 'green' })
    expect(res.status).toBe(200)
    const writes = writesOf('user_preferences')
    expect(writes).toHaveLength(2)
    expect(writes.every(w => w.op === 'upsert')).toBe(true)
    expect(writes.map(w => (w.values as Obj).user_id)).toEqual(['u-1', 'u-1'])
    expect(writes[1]!.values).toMatchObject({ primary_color: 'green' })
  })
  it.todo('SET-07: 1 row per user after two PUTs (real upsert idempotency, onConflict user_id) -> cover in tests/db; fake has no unique constraint')
})

describe('SET-08: PUT preferences isolation between users', () => {
  it('logged in as U1 with user_id=u-2 and organization_id=org-b in the body -> writes only U1; U2 row intact', async () => {
    seedBoth()
    const u2Before = structuredClone(prefRows().find(r => r.user_id === 'u-2')!)
    const res = await putPrefs({ user_id: 'u-2', organization_id: 'org-b', primary_color: 'pink' })
    expect(res.status).toBe(200)
    expect((res.body as Obj).user_id).toBe('u-1')
    const writes = writesOf('user_preferences')
    expect(writes).toHaveLength(1)
    expect(writes[0]!.values).toMatchObject({ user_id: 'u-1', primary_color: 'pink' })
    expect(Object.keys(writes[0]!.values as object)).not.toContain('organization_id')
    expect(prefRows().filter(r => r.user_id === 'u-2')).toEqual([u2Before])
  })
})

describe('SET-02a/b: PUT preferences validation and omitted fields', () => {
  it('control: valid PUT -> 200 and one upsert', async () => {
    const res = await putPrefs({ primary_color: 'blue', neutral_color: 'zinc', color_mode: 'dark', timezone: 'UTC' })
    expect(res.status).toBe(200)
    expect(writesOf('user_preferences')).toHaveLength(1)
  })

  // KF-73 (G3-SD-02): sem validação de tipo.
  for (const [label, value] of [['number', 123], ['object', { x: 1 }]] as const) {
    it.fails(`SET-02a (KF-73): primary_color ${label} -> 400 and nothing persisted`, async () => {
      const res = await putPrefs({ primary_color: value })
      expect(res.status).toBe(400)
      expect(writesOf('user_preferences')).toHaveLength(0)
      expect(prefRows()).toHaveLength(0)
    })
  }

  it('SET-02b: PUT {} on a dark row resets to defaults (caracteriza; decisão em G3-OQ-08 e G3-SD-07)', async () => {
    seedBoth()
    const res = await putPrefs({})
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ user_id: 'u-1', ...DEFAULT_PREFS })
    expect(writesOf('user_preferences')[0]!.values).toMatchObject({ color_mode: 'light' })
  })

  it("SET-02b: PUT {color_mode:''} on a dark row falls back to the default (caracteriza; decisão em G3-OQ-08 e G3-SD-07)", async () => {
    seedBoth()
    const res = await putPrefs({ color_mode: '' })
    expect(res.status).toBe(200)
    expect((res.body as Obj).color_mode).toBe('light')
    expect(writesOf('user_preferences')[0]!.values).toMatchObject({ color_mode: 'light', primary_color: 'purple' })
  })

  it.todo("SET-02a: color_mode 'neon' and timezone 'Not/AZone' -> valid sets undefined (G3-OQ-07)")
  it.todo('SET-02b: should an omitted field keep the saved value (merge) or reset? (G3-OQ-08)')
})

describe('SET-09: PUT preferences by role', () => {
  it.todo('SET-09: owner/admin/emp-sem on PUT /api/settings/preferences -> settings permission undefined (G3-OQ-10); not it.fails')
})

describe('SET-10: GET notifications defaults and merge', () => {
  it('no row -> defaults; subscriptions []; habit_reminders true; GET creates nothing', async () => {
    const res = await getNotif()
    expect(res.status).toBe(200)
    expect(res.body).toEqual(DEFAULT_NOTIF)
    expect(fake.writes).toHaveLength(0)
  })

  it('partial row -> saved values merged over defaults; subscriptions []; habit_reminders true (row has no such column)', async () => {
    notifRows().push({ user_id: 'u-1', channel_email: false, weekly_digest: true })
    const res = await getNotif()
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ...DEFAULT_NOTIF, channel_email: false, weekly_digest: true, subscriptions: [], habit_reminders: true })
    expect(fake.writes).toHaveLength(0)
  })
})

describe('SET-11: GET notifications isolation between users', () => {
  it('logged in as U1 with ?user_id=u-2 -> only U1 data', async () => {
    seedBoth()
    const res = await getNotif({ user_id: 'u-2' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ channel_email: false, weekly_digest: true, channel_web_push: false })
  })
})

describe('SET-12: GET notifications query error', () => {
  it('select fails -> 500 "Failed to fetch notification preferences" without internal detail', async () => {
    fake.failNext('notification_preferences', 'relation secret_internal_detail exploded')
    const res = await getNotif()
    expect(res.status).toBe(500)
    expect(res.error?.statusMessage).toBe('Failed to fetch notification preferences')
    expect(res.error?.message).not.toContain('secret_internal_detail')
  })
})

describe('SET-13: PUT notifications without row', () => {
  it('{channel_email:false, weekly_digest:true} -> 200; false kept (??); omitted get defaults; one upsert', async () => {
    const res = await putNotif({ channel_email: false, weekly_digest: true })
    expect(res.status).toBe(200)
    const expectedRow = {
      user_id: 'u-1',
      channel_in_app: true,
      channel_email: false,
      channel_web_push: false,
      channel_mobile_push: false,
      weekly_digest: true,
      product_updates: true,
      important_updates: true,
      web_push_permission: 'default',
      mobile_push_permission: 'default'
    }
    expect(res.body).toEqual({ ...expectedRow, habit_reminders: true, subscriptions: [] })
    const writes = writesOf('notification_preferences')
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ op: 'upsert', values: expectedRow })
    expect(notifRows()).toHaveLength(1)
  })
})

describe('SET-16: PUT notifications isolation between users', () => {
  it('logged in as U1 with user_id=u-2 in the body -> writes only U1; U2 row intact', async () => {
    seedBoth()
    const u2Before = structuredClone(notifRows().find(r => r.user_id === 'u-2')!)
    const res = await putNotif({ user_id: 'u-2', channel_email: false })
    expect(res.status).toBe(200)
    expect((res.body as Obj).user_id).toBe('u-1')
    const writes = writesOf('notification_preferences')
    expect(writes).toHaveLength(1)
    expect((writes[0]!.values as Obj).user_id).toBe('u-1')
    expect(notifRows().filter(r => r.user_id === 'u-2')).toEqual([u2Before])
  })
})

describe('SET-18: PUT notifications upsert error', () => {
  it('upsert fails -> 500 "Failed to save notification preferences" without internal detail', async () => {
    fake.failNext('notification_preferences', 'relation secret_internal_detail exploded')
    const res = await putNotif({ channel_email: false })
    expect(res.status).toBe(500)
    expect(res.error?.statusMessage).toBe('Failed to save notification preferences')
    expect(res.error?.message).not.toContain('secret_internal_detail')
    expect(notifRows()).toHaveLength(0)
  })
})

describe('SET-02c/14/15/17: PUT notifications validation, reset and habit_reminders', () => {
  it('control: valid PUT -> 200 and one upsert', async () => {
    const res = await putNotif({ channel_email: false, channel_in_app: true })
    expect(res.status).toBe(200)
    expect(writesOf('notification_preferences')).toHaveLength(1)
  })

  // KF-73 (G3-SD-02): sem validação de tipo.
  for (const [label, value] of [["'yes'", 'yes'], ['1', 1], ['null', null]] as const) {
    it.fails(`SET-02c (KF-73): channel_email ${label} -> 400 and nothing persisted`, async () => {
      const res = await putNotif({ channel_email: value })
      expect(res.status).toBe(400)
      expect(writesOf('notification_preferences')).toHaveLength(0)
      expect(notifRows()).toHaveLength(0)
    })
  }

  it('SET-15 control: PUT {habit_reminders:false} echoes false in the response (caracteriza)', async () => {
    const res = await putNotif({ habit_reminders: false })
    expect(res.status).toBe(200)
    expect((res.body as Obj).habit_reminders).toBe(false)
  })

  // KF-74 (G3-SD-05): habit_reminders não está no upsert nem no select.
  it.fails('SET-15 (KF-74): PUT {habit_reminders:false} then GET -> GET returns false', async () => {
    await putNotif({ habit_reminders: false })
    const res = await getNotif()
    expect(res.status).toBe(200)
    expect((res.body as Obj).habit_reminders).toBe(false)
  })

  it.todo("SET-02c: web_push_permission 'xyz' and other value sets -> valid set undefined (G3-OQ-07)")
  it.todo('SET-14: PUT {} on a row with channel_email:false resets everything to defaults -> merge or reset? (G3-OQ-08, G3-SD-07)')
  it.todo('SET-17: PUT /api/settings/notifications by role (owner/admin/emp-sem) -> settings permission undefined (G3-OQ-10); not it.fails')
})

describe('SET-01: POST notifications/device (stub, G3-SD-06)', () => {
  it('SET-01a: {token, platform} -> 200 {ok, receivedAt, device} mirroring the body; nothing persisted (caracteriza)', async () => {
    const body = { token: 't1', platform: 'web' }
    const res = await postDevice(body)
    expect(res.status).toBe(200)
    const out = res.body as Obj
    expect(out.ok).toBe(true)
    expect(out.device).toEqual(body)
    expect(new Date(out.receivedAt).toISOString()).toBe(out.receivedAt)
    expect(fake.writes).toHaveLength(0)
    expect(Object.values(fake.tables).every(rows => rows.length === 0)).toBe(true)
  })

  it("SET-01d (stub G3-SD-06): no row written today; when persistence exists (G3-OQ-09), rewrite to 'associated only to U1'", async () => {
    seedBoth()
    const before = structuredClone(fake.tables)
    const res = await postDevice({ token: 't1', platform: 'web', user_id: 'u-2' })
    expect(res.status).toBe(200)
    expect(fake.writes).toHaveLength(0)
    expect(fake.tables).toEqual(before)
  })

  // KF-75 (G3-SD-06): o stub ecoa qualquer corpo, sem validar token.
  for (const [label, body] of [['no body', undefined], ['null body', null], ['non-object body', 'texto'], ['empty token', { token: '' }]] as const) {
    it.fails(`SET-01c (KF-75): ${label} -> 400 and nothing echoed`, async () => {
      const res = await postDevice(body)
      expect(res.status).toBe(400)
      expect(res.body).toBeUndefined()
    })
  }

  it.todo('SET-01c: large/HTML payload echoed (no limit defined; contract decision in G3-OQ-09 / G3-SD-06)')
  it.todo('SET-01b: POST the same token twice; same token by U2 -> idempotent device registry bound to one user (G3-OQ-09; future feature, no persistence today)')
  it.todo('SET-01e: POST device by role (owner/admin/emp-sem) -> settings permission undefined (G3-OQ-10); route already in KF-09 baseline')
})
