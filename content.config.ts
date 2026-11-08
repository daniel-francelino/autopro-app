import { defineCollection, z } from '@nuxt/content'

export const collections = {
  pricing: defineCollection({
    source: '2.pricing.yml',
    type: 'page',
    schema: z.object({
      logos: z.object({
        title: z.string().nonempty(),
        icons: z.array(z.string())
      }),
      faq: z.object({
        title: z.string().nonempty(),
        description: z.string().nonempty()
      })
    })
  }),
  faq: defineCollection({
    source: 'faq.yml',
    type: 'data',
    schema: z.object({
      items: z.array(
        z.object({
          label: z.string().nonempty(),
          content: z.string().nonempty()
        })
      )
    })
  })
}
