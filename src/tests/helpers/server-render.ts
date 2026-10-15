// Resolves async server components (the way the RSC renderer would) so the result can be
// rendered with Testing Library. Sync components are left for React to render.
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';

const isAsyncComponent = (type: unknown): type is (props: unknown) => Promise<ReactNode> =>
  typeof type === 'function' && type.constructor?.name === 'AsyncFunction';

export async function resolveServerTree(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolveServerTree));
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (isAsyncComponent(element.type)) return resolveServerTree(await element.type(element.props));
  if (element.props.children === undefined) return element;
  return cloneElement(element, { children: await resolveServerTree(element.props.children) });
}
