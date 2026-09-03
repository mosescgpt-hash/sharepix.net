import { GetStaticPaths, GetStaticProps } from 'next';
import Link from 'next/link';
import Layout from '@/components/Layout';
import { HELP_ARTICLES, HelpArticle, SUPPORT_EMAIL, findArticle } from '@/lib/help';

interface Props {
  article: HelpArticle;
  related: { slug: string; title: string }[];
}

export default function HelpArticlePage({ article, related }: Props) {
  return (
    <Layout title={article.title}>
      <article className="mx-auto max-w-2xl py-10">
        <Link href="/help" className="text-sm text-ink/60 hover:text-accent">
          ← All help articles
        </Link>

        <p className="mt-6 text-sm uppercase tracking-wide text-ink/50">
          {article.category} · {article.audience === 'guest' ? 'For guests' : 'For hosts'}
        </p>
        <h1 className="mt-1 font-display text-3xl font-bold">{article.title}</h1>
        <p className="mt-3 text-lg text-ink/70">{article.summary}</p>

        <div className="mt-8 space-y-5">
          {article.blocks.map((block, index) => {
            if (block.kind === 'steps') {
              return (
                <ol key={index} className="list-decimal space-y-2 pl-5">
                  {block.steps.map((step, stepIndex) => (
                    <li key={stepIndex} className="pl-1">
                      {step}
                    </li>
                  ))}
                </ol>
              );
            }
            if (block.kind === 'contact') {
              return (
                <p key={index} className="rounded-xl border border-line bg-card shadow-card px-4 py-3">
                  {block.text}{' '}
                  <a
                    href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(article.title)}`}
                    className="font-medium text-accent hover:underline"
                  >
                    {SUPPORT_EMAIL}
                  </a>
                </p>
              );
            }
            if (block.kind === 'note') {
              return (
                <p
                  key={index}
                  className="rounded-xl border border-accent/30 bg-accent/5 px-4 py-3 text-sm"
                >
                  {block.text}
                </p>
              );
            }
            return <p key={index}>{block.text}</p>;
          })}
        </div>

        {related.length > 0 ? (
          <div className="mt-12 border-t border-ink/10 pt-6">
            <h2 className="font-display text-lg font-bold">Related</h2>
            <ul className="mt-3 space-y-2">
              {related.map((item) => (
                <li key={item.slug}>
                  <Link href={`/help/${item.slug}`} className="text-accent hover:underline">
                    {item.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </article>
    </Layout>
  );
}

export const getStaticPaths: GetStaticPaths = async () => ({
  paths: HELP_ARTICLES.map((article) => ({ params: { slug: article.slug } })),
  fallback: false,
});

export const getStaticProps: GetStaticProps<Props> = async ({ params }) => {
  const slug = typeof params?.slug === 'string' ? params.slug : '';
  const article = findArticle(slug);
  if (!article) return { notFound: true };

  // Dead related-links are a test failure, not a runtime crash, so anything
  // unresolvable here is simply dropped.
  const related = (article.related ?? [])
    .map((relatedSlug) => findArticle(relatedSlug))
    .filter((item): item is HelpArticle => Boolean(item))
    .map((item) => ({ slug: item.slug, title: item.title }));

  return { props: { article, related } };
};
