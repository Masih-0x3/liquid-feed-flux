-- Create a test translation job to verify the system works
INSERT INTO jobs (type, payload, status) 
VALUES ('translate', '{"tweet_id": "https://twitter.com/disclosetv/status/1963058311042945495"}', 'pending');