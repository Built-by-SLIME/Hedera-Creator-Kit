import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Hedera Creator Kit',
  description: 'Documentation for the SLIME HCS domain registry and toolkit APIs',
  base: '/Hedera-Creator-Kit/',
  cleanUrls: true,
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/overview' },
      { text: 'API Reference', link: '/api/rest' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Domain Registry',
          items: [
            { text: 'Overview', link: '/guide/overview' },
            { text: 'Architecture', link: '/guide/architecture' },
            { text: 'Registration Flow', link: '/guide/registration' },
            { text: 'Pricing', link: '/guide/pricing' },
            { text: 'Renewals', link: '/guide/renewals' },
            { text: 'Resolution & Listing', link: '/guide/resolution' },
            { text: 'TLD Administration', link: '/guide/tld-admin' },
            { text: 'Known Limitations', link: '/guide/limitations' },
          ],
        },
      ],
      '/api/': [
        {
          text: 'API Reference',
          items: [
            { text: 'Public Endpoints', link: '/api/rest' },
            { text: 'Admin Endpoints', link: '/api/admin' },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/Built-by-SLIME/Hedera-Creator-Kit' },
    ],
    footer: {
      message: 'Built by SLIME',
      copyright: 'Hedera Creator Kit',
    },
    search: { provider: 'local' },
  },
})
