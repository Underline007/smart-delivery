import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { toast } from 'sonner'
import { toMessage } from './errors'

interface ActionOptions<TResult> {
  /** Toast shown on success. */
  success?: string
  /** Queries to refetch on success. */
  invalidate?: QueryKey[]
  onSuccess?: (result: TResult) => void
}

/** Mutation with Vietnamese error toasts and query invalidation. */
export function useAction<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
  options: ActionOptions<TResult> = {},
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: async (result) => {
      await Promise.all(
        (options.invalidate ?? []).map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      )
      if (options.success) toast.success(options.success)
      options.onSuccess?.(result)
    },
    onError: async (error) => {
      toast.error(await toMessage(error))
    },
  })
}
