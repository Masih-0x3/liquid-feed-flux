-- Clean up old pending delivery jobs that are failing
DELETE FROM jobs 
WHERE type = 'deliver' 
  AND status = 'pending' 
  AND last_error = 'Processing failed';

-- Create a test translation job for a post that has been translated
INSERT INTO jobs (type, payload, status) 
VALUES ('deliver', '{"tweet_id": "https://twitter.com/disclosetv/status/1963058311042945495"}', 'pending');