export const TWEET_MAX = 280;
const TWEET_SOFT_TRIGGER = 270;

// X counts normalized text, emoji sequences, and t.co URLs by weight:
// https://docs.x.com/fundamentals/counting-characters
function* tweetAtoms(text: string, urls: Array<{ indices: [number, number] }>): Generator<string> {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  let offset = 0;
  for (const entity of urls) {
    for (const { segment } of segmenter.segment(text.slice(offset, entity.indices[0]))) {
      yield segment;
    }
    yield text.slice(entity.indices[0], entity.indices[1]);
    offset = entity.indices[1];
  }
  for (const { segment } of segmenter.segment(text.slice(offset))) yield segment;
}

/** Split digest content without cutting a URL or Unicode grapheme. */
export async function buildThreadTweets(summary: string, header: string): Promise<string[]> {
  const { default: twitterText } = await import("npm:twitter-text@3.1.0");
  const { parseTweet, extractUrlsWithIndices } = twitterText;
  const lines = summary.normalize("NFC").split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const tweets: string[] = [];
  let current = "";
  const flush = () => {
    const text = current.trim();
    if (text) {
      if (!parseTweet(text).valid) throw new Error("digest_tweet_invalid_text");
      tweets.push(text);
    }
    current = "";
  };
  const append = (text: string) => {
    for (const atom of tweetAtoms(text, extractUrlsWithIndices(text))) {
      if (parseTweet(atom).weightedLength > TWEET_MAX) {
        throw new Error("digest_tweet_unsplittable_grapheme");
      }
      if (parseTweet(current + atom).weightedLength > TWEET_MAX) flush();
      current += atom;
    }
  };
  append(`${header.normalize("NFC").trim()}\n\n`);
  for (const line of lines) {
    if (parseTweet(current + line + "\n").weightedLength > TWEET_SOFT_TRIGGER) flush();
    append(`${line}\n`);
  }
  flush();
  return tweets;
}
