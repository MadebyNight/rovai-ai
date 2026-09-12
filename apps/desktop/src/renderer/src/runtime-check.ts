import type { AdapterKind, RuntimeModelCatalogView } from '@contracts'

export type ProductRuntimeCheckResult = {
  scheduled: true
  completed: true
  ready: boolean
  outcome: 'ready' | 'stable_failure' | 'deferred'
  status: 'ready' | 'stable_failure' | 'deferred'
  runtimeKind: AdapterKind
}

export async function requestProductRuntimeCheck(runtimeKind: AdapterKind): Promise<ProductRuntimeCheckResult> {
  // Core refreshes discovery inputs for every explicit check, including guides.
  return window.rovai.request<ProductRuntimeCheckResult>('runtime.product.check', { runtimeKind })
}

export function openRuntimeModelCatalog(runtimeKind: AdapterKind): Promise<RuntimeModelCatalogView> {
  return window.rovai.request<RuntimeModelCatalogView>('runtime.modelCatalog.open', { runtimeKind })
}
