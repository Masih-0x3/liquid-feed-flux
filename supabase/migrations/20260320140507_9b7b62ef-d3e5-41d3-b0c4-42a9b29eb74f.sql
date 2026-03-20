
-- Fix security definer view warnings by setting security_invoker
ALTER VIEW public.telegram_channel_current SET (security_invoker = on);
ALTER VIEW public.telegram_member_growth SET (security_invoker = on);
ALTER VIEW public.telegram_message_performance SET (security_invoker = on);
