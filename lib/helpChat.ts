/**
 * The dashboard's help chat: answers a host's question from the help centre
 * and the dashboard's own "I want to…" list, entirely in the browser.
 *
 * Nothing a host types is sent anywhere. That keeps it free to run and keeps
 * their words on their own device. It is a matcher, not a model: it finds the
 * articles and settings whose words overlap the question, best first.
 *
 * searchHelp (lib/help.ts) needs every word to match, which suits a search box
 * but not a sentence like "how do I stop people downloading photos". This
 * scores instead, after dropping the words every question has.
 */

// Relative, not `@/`: covered by the node test project, which has no alias.
import { HELP_ARTICLES, type HelpArticle } from './help';
import { DASHBOARD_JUMPS, type DashboardJump, type JumpConditions } from './dashboardJumps';

const STOPWORDS = new Set(
  (
    'a an and are as at be but by can could do does for from get got have how i ' +
    'if in into is it its me my of on or our please should so that the their them ' +
    'then there this to too us want was we what when where which who why will with ' +
    'would you your yours am any some just make need help ' +
    // Verbs nearly every settings question has: "turn off", "switch on".
    'turn turning switch off on'
  ).split(' '),
);

/** A crude stem, so "downloading", "downloads" and "download" meet. */
function stem(word: string): string {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** The words worth matching in a piece of text, stemmed, without stopwords. */
export function questionWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .map(stem);
}

interface Doc<T> {
  item: T;
  /** Field words, each field with its weight. */
  fields: Array<{ words: Set<string>; weight: number }>;
}

/**
 * Score each document by the question words it contains, a word counting
 * more the fewer documents have it (so "cover" outweighs "photo", which is in
 * nearly every article), and more in a title than in a summary.
 */
function rank<T>(docs: Doc<T>[], words: string[]): Array<{ item: T; score: number; matched: number }> {
  const unique = [...new Set(words)];
  const rarity = new Map(
    unique.map((w) => {
      const df = docs.filter((d) => d.fields.some((f) => f.words.has(w))).length;
      return [w, df === 0 ? 0 : Math.log(1 + docs.length / df)];
    }),
  );
  return docs
    .map((doc) => {
      let score = 0;
      let matched = 0;
      for (const w of unique) {
        const best = Math.max(0, ...doc.fields.filter((f) => f.words.has(w)).map((f) => f.weight));
        score += best * (rarity.get(w) ?? 0);
        if (best > 0) matched += 1;
      }
      return { item: doc.item, score, matched };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

const wordSet = (text: string) => new Set(questionWords(text));

const ARTICLE_DOCS: Doc<HelpArticle>[] = HELP_ARTICLES.map((article) => ({
  item: article,
  fields: [
    { words: wordSet(article.title), weight: 3 },
    { words: wordSet(article.keywords.join(' ')), weight: 2 },
    { words: wordSet(`${article.summary} ${article.category}`), weight: 1 },
  ],
}));

const JUMP_DOCS: Doc<DashboardJump>[] = DASHBOARD_JUMPS.flatMap((group) =>
  group.jumps.map((jump) => ({
    item: jump,
    fields: [{ words: wordSet(`${jump.label} ${jump.key.replace(/-/g, ' ')}`), weight: 1 }],
  })),
);

export interface HelpAnswer {
  articles: HelpArticle[];
  jumps: DashboardJump[];
}

/** Whether a question is asking for the walkthrough itself. */
export function wantsGuide(text: string): boolean {
  return /\b(guide|walk ?through|walk me|tour|show me around|set ?up|customi[sz]|where do i start|getting started)\b/i.test(
    text,
  );
}

/**
 * The best few articles and dashboard shortcuts for a question. Host articles
 * rank above guest ones (this is the host's dashboard), and a shortcut is
 * offered only when its card is on this event's page.
 */
export function answerQuestion(text: string, conditions: JumpConditions): HelpAnswer {
  const words = questionWords(text);
  if (words.length === 0) return { articles: [], jumps: [] };

  const ranked = rank(ARTICLE_DOCS, words);
  // Only answers close to the best one: a long tail of weak matches reads as
  // the chat not understanding.
  const top = ranked[0]?.score ?? 0;
  const articles = ranked
    .filter((r) => r.score >= Math.max(4, top * 0.5))
    .map((r) => ({ ...r, score: r.score + (r.item.audience === 'host' ? 0.5 : 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((r) => r.item);

  const rankedJumps = rank(
    JUMP_DOCS.filter((d) => !d.item.when || d.item.when(conditions)),
    words,
  );
  const topJump = rankedJumps[0]?.score ?? 0;
  // A shortcut is a promise of "this is the setting", so it has to match most
  // of what was asked, not one shared word like "guest".
  const asked = new Set(words).size;
  const jumps = rankedJumps
    .filter((r) => r.matched * 2 > asked && r.score >= Math.max(1, topJump * 0.6))
    .slice(0, 2)
    .map((r) => r.item);

  return { articles, jumps };
}
