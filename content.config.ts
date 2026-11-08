import { defineCollection, z } from '@nuxt/content'

export const collections = {
  pricing: defineCollection({
    source: '2.pricing.yml',
    type: 'page',
    schema: z.object({
      faq: z.object({
        title: z.string().nonempty(),
        description: z.string().nonempty()
      })
    })
  }),
  paginas: defineCollection({
    source: 'paginas/*.md',
    type: 'page',
    schema: z.object({
      answer: z.string().nonempty(),
      updatedAt: z.string().nonempty(),
      showPlans: z.boolean().optional(),
      related: z.array(z.string()).optional(),
      faq: z.array(
        z.object({
          label: z.string().nonempty(),
          content: z.string().nonempty()
        })
      ).optional()
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
