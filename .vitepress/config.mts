import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitepress';

const REPO = 'https://github.com/tinwritescode/rain';

// NOTE: GitHub-style heading ids, so anchors in README and examples work both on GitHub and here.
const slugify = (heading: string) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\w\- ]/g, '')
    .replace(/ /g, '-');

// NOTE: Pages are the repo's own Markdown. Relative links to non-page files (diffs, folders, LICENSE) point at GitHub.
const toRepoUrl = (href: string, pagePath: string): string | null => {
  if (/^([a-z]+:|#|\/)/i.test(href)) return null;

  const [path] = href.split('#');
  if (path.endsWith('.md')) return null;

  const target = posix.normalize(posix.join(posix.dirname(pagePath), path)).replace(/\/$/, '');
  const kind = posix.extname(target) === '' ? 'tree' : 'blob';
  return `${REPO}/${kind}/main/${target}`;
};

export default defineConfig({
  title: 'rAIn',
  description: 'Calm-senior backend mode for AI agents. Flat, explicit, boring code that stays correct when two requests land at once.',
  base: '/rain/',
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ['README.md', 'examples/fixture/**'],

  vite: {
    publicDir: fileURLToPath(new URL('../assets', import.meta.url)),
  },

  markdown: {
    anchor: { slugify },
    config: (md) => {
      md.core.ruler.push('repo-links', (state) => {
        for (const token of state.tokens) {
          for (const child of token.children ?? []) {
            if (child.type !== 'link_open') continue;

            const url = toRepoUrl(child.attrGet('href') ?? '', state.env.relativePath);
            if (url !== null) child.attrSet('href', url);
          }
        }
      });
    },
  },

  themeConfig: {
    logo: { src: '/logo.svg', alt: 'rAIn' },
    siteTitle: false,

    nav: [
      { text: 'Rules', link: '/skills/rain/SKILL' },
      { text: 'NestJS', link: '/skills/rain/nestjs' },
      { text: 'Examples', link: '/examples/README' },
    ],

    sidebar: [
      {
        text: 'Skill',
        items: [
          { text: 'Rules', link: '/skills/rain/SKILL' },
          { text: 'NestJS forms', link: '/skills/rain/nestjs' },
        ],
      },
      {
        text: 'Examples',
        items: [
          { text: 'With and without rAIn', link: '/examples/README' },
          { text: '/rain review output', link: '/examples/review/close-without-rain' },
        ],
      },
    ],

    socialLinks: [{ icon: 'github', link: REPO }],
    editLink: { pattern: `${REPO}/edit/main/:path` },
    search: { provider: 'local' },
    outline: [2, 3],
    footer: { message: 'MIT License. Rules come from real incidents and real review comments.' },
  },
});
