import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { SUPPORT_EMAIL, type HelpArticle } from '@/lib/help';
import { answerQuestion, wantsGuide } from '@/lib/helpChat';
import type { DashboardJump, JumpConditions } from '@/lib/dashboardJumps';

type Message =
  | { from: 'host'; text: string }
  | {
      from: 'help';
      text: string;
      articles?: HelpArticle[];
      jumps?: DashboardJump[];
      offerGuide?: boolean;
    };

const GREETING: Message = {
  from: 'help',
  text: 'Hi! Ask me anything about setting up or running your event, or let me walk you through the options.',
  offerGuide: true,
};

/**
 * The dashboard's help chat: a button in the corner that opens a small panel.
 * Answers come from the help centre and the dashboard's shortcuts, matched in
 * the browser (lib/helpChat.ts), so nothing typed here leaves the device. It
 * also starts guided customization, and always ends in a way to reach a person.
 */
export default function HelpChat({
  conditions,
  onOpenJump,
  onStartGuide,
}: {
  conditions: JumpConditions;
  onOpenJump: (key: string) => void;
  onStartGuide: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([GREETING]);
  const [draft, setDraft] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // The list scrolls itself to the newest message; the page stays put.
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function ask(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    const answer = answerQuestion(text, conditions);
    const guide = wantsGuide(text);
    let reply: Message;
    if (answer.articles.length === 0 && answer.jumps.length === 0) {
      reply = guide
        ? { from: 'help', text: 'I can walk you through every option, one at a time.', offerGuide: true }
        : {
            from: 'help',
            text: `I couldn't find an answer to that. Try other words, browse the help centre, or email us at ${SUPPORT_EMAIL} and a person will reply.`,
          };
    } else {
      reply = {
        from: 'help',
        text: answer.jumps.length > 0 ? 'Here is where to do that, and what might help:' : 'This might help:',
        articles: answer.articles,
        jumps: answer.jumps,
        offerGuide: guide,
      };
    }
    setMessages((prev) => [...prev, { from: 'host', text }, reply]);
  }

  function startGuide() {
    setOpen(false);
    onStartGuide();
  }

  return (
    <>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-4 right-4 z-40 rounded-full bg-ink px-5 py-3 text-sm font-semibold text-canvas shadow-lg"
          aria-haspopup="dialog"
        >
          Help
        </button>
      ) : (
        <div
          role="dialog"
          aria-label="Help"
          className="fixed inset-x-0 bottom-0 z-40 flex max-h-[80vh] flex-col border-t border-charcoal/15 bg-canvas shadow-2xl sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-96 sm:border"
        >
          <div className="flex items-center justify-between border-b border-charcoal/10 px-4 py-3">
            <p className="font-sans text-base font-bold">Help</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-sm text-charcoal/65 underline"
            >
              Close
            </button>
          </div>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
            {messages.map((m, i) =>
              m.from === 'host' ? (
                <p key={i} className="ml-8 bg-ink px-3 py-2 text-canvas">
                  {m.text}
                </p>
              ) : (
                <div key={i} className="mr-4 space-y-2 bg-paper px-3 py-2">
                  <p>{m.text}</p>
                  {m.jumps?.map((jump) => (
                    <button
                      key={jump.key}
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onOpenJump(jump.key);
                      }}
                      className="block w-full border border-ink/20 bg-canvas px-3 py-2 text-left font-medium hover:border-ink"
                    >
                      {jump.label} →
                    </button>
                  ))}
                  {m.articles?.map((article) => {
                    const id = `${i}:${article.slug}`;
                    const isOpen = expanded === id;
                    return (
                      <div key={article.slug} className="border-t border-charcoal/10 pt-2">
                        <button
                          type="button"
                          onClick={() => setExpanded(isOpen ? null : id)}
                          aria-expanded={isOpen}
                          className="text-left font-medium text-pine underline"
                        >
                          {article.title}
                        </button>
                        <p className="text-xs text-charcoal/65">{article.summary}</p>
                        {isOpen ? <ArticleBody article={article} /> : null}
                      </div>
                    );
                  })}
                  {m.offerGuide ? (
                    <button type="button" onClick={startGuide} className="spx-btn-ink">
                      Start guided customization
                    </button>
                  ) : null}
                </div>
              ),
            )}
          </div>

          <form onSubmit={ask} className="border-t border-charcoal/10 p-3">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Ask a question"
                aria-label="Your question"
                className="spx-input min-w-0 flex-1"
              />
              <button type="submit" className="spx-btn-ink shrink-0" disabled={!draft.trim()}>
                Ask
              </button>
            </div>
            <p className="mt-2 text-[11px] text-charcoal/55">
              Answers come from our{' '}
              <Link href="/help" className="underline">
                help centre
              </Link>
              . What you type stays on this device. Still stuck?{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="underline">
                {SUPPORT_EMAIL}
              </a>
            </p>
          </form>
        </div>
      )}
    </>
  );
}

/** An article's steps and notes, inline, with a link to the full page. */
function ArticleBody({ article }: { article: HelpArticle }) {
  return (
    <div className="mt-2 space-y-2 text-xs text-charcoal/80">
      {article.blocks.map((block, i) => {
        if (block.kind === 'steps') {
          return (
            <ol key={i} className="list-decimal space-y-1 pl-4">
              {block.steps.map((step, j) => (
                <li key={j}>{step}</li>
              ))}
            </ol>
          );
        }
        if (block.kind === 'contact') {
          return (
            <p key={i}>
              {block.text}{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="underline">
                {SUPPORT_EMAIL}
              </a>
            </p>
          );
        }
        return (
          <p key={i} className={block.kind === 'note' ? 'italic' : undefined}>
            {block.text}
          </p>
        );
      })}
      <Link href={`/help/${article.slug}`} className="inline-block text-pine underline">
        Open the full article
      </Link>
    </div>
  );
}
