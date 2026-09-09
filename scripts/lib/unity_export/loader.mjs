const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  throw new Error(`Unity content exporter needs Node >= 22.18 (found ${process.versions.node}); pin NODE_VERSION in netlify.toml`);
}

const { statSync } = await import('node:fs');
const { registerHooks } = await import('node:module');

const contentRoot = new URL('../../../src/features/world/content/', import.meta.url);
let registered = false;

/** Resolve authored TS imports without a compiler, a mirror, or dependencies. */
export function loadContentModule(relativePath) {
  if (!registered) {
    registerHooks({
      resolve(specifier, context, nextResolve) {
        try {
          return nextResolve(specifier, context);
        } catch (error) {
          if (error.code !== 'ERR_MODULE_NOT_FOUND' || !specifier.startsWith('.') ||
              !context.parentURL?.startsWith(contentRoot.href)) throw error;
          // Appending .ts also handles dotted stems such as landmarks.generated.
          const candidate = new URL(
            specifier.endsWith('.js') ? specifier.slice(0, -3) + '.ts' : specifier + '.ts',
            context.parentURL,
          );
          if (!candidate.href.startsWith(contentRoot.href) ||
              !statSync(candidate, { throwIfNoEntry: false })?.isFile()) throw error;
          return nextResolve(candidate.href, context);
        }
      },
    });
    registered = true;
  }
  return import(new URL(relativePath, contentRoot).href);
}

export async function loadValidatedContent() {
  const content = await loadContentModule('index.ts');
  const errors = content.validateContent();
  if (errors.length) throw new Error(`Content validation failed:\n${errors.join('\n')}`);
  return content;
}
