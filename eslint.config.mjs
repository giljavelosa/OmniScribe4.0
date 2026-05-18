import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const eslintConfig = [
  // Next.js + TypeScript baseline.
  ...nextCoreWebVitals,
  ...nextTypescript,

  // Project-wide ignores.
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'dist/**',
      'build/**',
      'src/generated/**',
      'prisma/migrations/**',
      'coverage/**',
    ],
  },

  // Clinical + admin surfaces: no native confirm/alert (anti-regression rule 22).
  // Covers bare `confirm(...)` / `alert(...)` AND `window.confirm(...)` /
  // `globalThis.confirm(...)` (and the same for alert). A bare-identifier-only
  // selector can be bypassed by prefixing with `window.`.
  //
  // NOTE: ui-context.md also forbids hardcoded type sizes like `text-[14px]` in
  // clinical/admin surfaces, but that rule is NOT yet enforced here. Implementing
  // it cleanly requires grandfathering existing intentional fine-print uses
  // (`text-[10px]` / `text-[11px]` for metadata badges + table headers) — tracked
  // as a follow-up. Do not add a `text-[Npx]` selector without that audit, or CI
  // will block on pre-existing patterns.
  {
    files: ['src/app/(clinical)/**/*.{ts,tsx}', 'src/app/(admin)/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.name="confirm"]',
          message:
            'No native confirm() in clinical/admin surfaces — use <AlertDialog>. (Anti-regression rule 22.)',
        },
        {
          selector: 'CallExpression[callee.name="alert"]',
          message:
            'No native alert() in clinical/admin surfaces — use <StatusBanner> or <AlertDialog>. (Anti-regression rule 22.)',
        },
        {
          selector:
            'CallExpression[callee.type="MemberExpression"][callee.object.name=/^(window|globalThis)$/][callee.property.name="confirm"]',
          message:
            'No window.confirm() / globalThis.confirm() in clinical/admin surfaces — use <AlertDialog>. (Anti-regression rule 22.)',
        },
        {
          selector:
            'CallExpression[callee.type="MemberExpression"][callee.object.name=/^(window|globalThis)$/][callee.property.name="alert"]',
          message:
            'No window.alert() / globalThis.alert() in clinical/admin surfaces — use <StatusBanner> or <AlertDialog>. (Anti-regression rule 22.)',
        },
      ],
    },
  },

  // LLM + transcription ingress lock-in.
  //  - rule 6: all AI calls go through src/services/llm/ (PHI guard lives there)
  //  - rule 11: all transcription goes through src/services/transcription/
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/services/llm/**', 'src/services/transcription/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@aws-sdk/client-bedrock-runtime', '@aws-sdk/client-bedrock-runtime/*'],
              message:
                'All AI calls go through src/services/llm/. Anti-regression rule 6.',
            },
            {
              group: ['soniox', 'soniox/*'],
              message:
                'All transcription goes through src/services/transcription/. Anti-regression rule 11.',
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
