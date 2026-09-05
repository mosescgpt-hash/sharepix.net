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
        className="spx-card block p-5 transition hover:border-charcoal/30"
      >
        <span className="font-medium">{article.title}</span>
        <span className="mt-0.5 block text-sm text-charcoal/60">{article.summary}</span>
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
        <h1 className="spx-display text-center">
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
            className="spx-input"
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
                  ? 'border-ink bg-ink text-canvas'
                   : 'border-charcoal/25 bg-paper text-charcoal hover:border-charcoal/60'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {results ? (
          <div className="mt-8">
            <p className="text-sm text-charcoal/60">
              {visible.length} result{visible.length === 1 ? '' : 's'} for “{query}”
            </p>
            {visible.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {visible.map((article) => (
                  <ArticleLink key={article.slug} article={article} />
                ))}
              </ul>
            ) : (
              <p className="mt-3 bg-sand px-4 py-6 text-center text-charcoal/70">
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
                  <h2 className="font-sans text-xl font-bold tracking-[-0.02em]">{category}</h2>
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

        <div className="spx-card mt-12 p-7 text-center">
          <h2 className="font-sans text-lg font-bold tracking-[-0.02em]">Still stuck?</h2>
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
