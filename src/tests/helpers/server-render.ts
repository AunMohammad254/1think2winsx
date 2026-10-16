// Resolves async server components (the way the RSC renderer would) so the result can be
// rendered with Testing Library. Sync components are left for React to render.
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';

const isAsyncComponent = (type: unknown): type is (props: unknown) => Promise<ReactNode> =>
  typeof type === 'function' && type.constructor?.name === 'AsyncFunction';

/** Finds the first element of `type` in an (unrendered) element tree, e.g. a Suspense boundary. */
export function findElement(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, type);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (element.type === type) return element as ReactElement<Record<string, unknown>>;
  return findElement(element.props.children, type);
}

export async function resolveServerTree(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolveServerTree));
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (isAsyncComponent(element.type)) return resolveServerTree(await element.type(element.props));
  if (element.props.children === undefined) return element;
  return cloneElement(element, { children: await resolveServerTree(element.props.children) });
}
