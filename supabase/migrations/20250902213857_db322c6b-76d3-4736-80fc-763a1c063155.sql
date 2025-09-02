-- Fix function search path security issue
ALTER FUNCTION public.get_old_media(INTEGER) SET search_path = public;