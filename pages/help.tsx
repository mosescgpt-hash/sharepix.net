import { useMemo, useState } from 'react';
import Link from 'next/link';
import Layout from '@/components/Layout';
import {
  HELP_ARTICLES,
  HELP_CATEGORIES,
  HelpArticle,
  SUPPORT_EMAIL,
  articlesInCategory,
  searchHelp,
} from '@/lib/help';

type AudienceFilter = 'all' | 'guest' | 'host';

function ArticleLink({ article }: { article: HelpArticle }) {
  return (
    <li>
      <Link
        href={`/help/${article.slug}`}
        className="block rounded-xl border border-ink/10 bg-white p-4 transition hover:border-accent"
      >
        <span className="font-medium">{article.title}</span>
        <span className="mt-0.5 block text-sm text-ink/60">{article.summary}</span>
      </Link>
    </li>
  );
}

export default function HelpIndexPage() {
  const [query, setQuery] = useState('');
  const [audience, setAudience] = useState<AudienceFilter>('all');

  const results = useMemo(() => (query.trim() ? searchHelp(query) : null), [query]);

  const visible = useMemo(
    () =>
      (results ?? HELP_ARTICLES).filter(
        (article) => audience === 'all' || article.audience === audience,
      ),
    [results, audience],
  );

  return (
    <Layout title="Help">
      <section className="mx-auto max-w-3xl py-10">
        <h1 className="text-center font-display text-3xl font-extrabold sm:text-4xl">
          How can we help?
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-center text-ink/70">
          Answers for guests adding photos and for hosts running an event.
        </p>

        <div className="mt-8">
          <label htmlFor="help-search" className="sr-only">
            Search help articles
          </label>
          <input
            id="help-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search — try “video”, “download”, “QR code”"
            className="w-full rounded-full border border-ink/20 px-5 py-3 outline-none focus:border-accent"
          />
        </div>

        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {(
            [
              ['all', 'Everything'],
              ['guest', 'I am a guest'],
              ['host', 'I am the host'],
            ] as [AudienceFilter, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setAudience(value)}
              className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                audience === value
                  ? 'border-accent bg-accent text-white'
                  : 'border-ink/20 bg-white text-ink hover:border-accent'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {results ? (
          <div className="mt-8">
            <p className="text-sm text-ink/60">
              {visible.length} result{visible.length === 1 ? '' : 's'} for “{query}”
            </p>
            {visible.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {visible.map((article) => (
                  <ArticleLink key={article.slug} article={article} />
                ))}
              </ul>
            ) : (
              <p className="mt-3 rounded-xl bg-smoke px-4 py-6 text-center text-ink/70">
                Nothing matched. Try a single word — “print”, “slideshow”, “refund” — or
                browse the categories by clearing the search.
              </p>
            )}
          </div>
        ) : (
          <div className="mt-10 space-y-10">
            {HELP_CATEGORIES.map((category) => {
              const articles = articlesInCategory(category).filter(
                (article) => audience === 'all' || article.audience === audience,
              );
              if (articles.length === 0) return null;
              return (
                <div key={category}>
                  <h2 className="font-display text-xl font-bold">{category}</h2>
                  <ul className="mt-3 space-y-2">
                    {articles.map((article) => (
                      <ArticleLink key={article.slug} article={article} />
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-12 rounded-2xl border border-ink/10 bg-white p-6 text-center">
          <h2 className="font-display text-lg font-bold">Still stuck?</h2>
          <p className="mt-2 text-sm text-ink/70">
            Email us the event name and what you saw on screen, and we will sort it out.
          </p>
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="mt-4 inline-block rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-white hover:bg-night"
          >
            {SUPPORT_EMAIL}
          </a>
        </div>
      </section>
    </Layout>
  );
}
