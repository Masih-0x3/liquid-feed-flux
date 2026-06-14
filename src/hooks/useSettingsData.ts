import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchSampleTweets,
  fetchSettings,
  previewTranslation,
  saveSetting,
  type PreviewTranslationInput,
  type PreviewTranslationResult,
} from '@/api/settingsData';
import { useToast } from '@/hooks/use-toast';

export * from '@/api/settingsData';

export function useSettingsData() {
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
    staleTime: 60_000,
  });

  const samplesQuery = useQuery({
    queryKey: ['settings-samples'],
    queryFn: fetchSampleTweets,
    staleTime: 60_000,
  });

  return { settingsQuery, samplesQuery };
}

export function useSaveSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: saveSetting,
    onSuccess: () => {
      toast({ title: 'Settings saved successfully' });
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: () => {
      toast({ title: 'Error saving settings', description: 'Could not save settings', variant: 'destructive' });
    },
  });
}

export function useTranslationPreview() {
  const { toast } = useToast();
  return useMutation<PreviewTranslationResult, Error, PreviewTranslationInput>({
    mutationFn: previewTranslation,
    onError: (err) => {
      toast({ title: 'Translation preview failed', description: err.message, variant: 'destructive' });
    },
  });
}
