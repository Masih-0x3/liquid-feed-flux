-- Fix account language configuration to translate to Persian instead of English
UPDATE accounts 
SET lang_dst = 'fa' 
WHERE handle = 'rss-feed' AND lang_dst = 'en';