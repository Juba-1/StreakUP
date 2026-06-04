import { useMutation } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Bot, Loader2, Send, Sparkles } from 'lucide-react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { invokeAiRouter } from '@/core/ai/router'
import { useI18n } from '@/core/i18n/I18nProvider'
import { RenderAiMarkdown } from '@/lib/render-ai-markdown'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
import { cn } from '@/lib/utils'

type ChatMessage = { role: 'user' | 'assistant'; text: string }

const QUICK_PROMPTS = [
  { id: 'week', key: 'hq.roi.copilot.promptWeek' },
  { id: 'retention', key: 'hq.roi.copilot.promptRetention' },
  { id: 'rewards', key: 'hq.roi.copilot.promptRewards' },
] as const

export function TenantAICopilot() {
  const { t, locale } = useI18n()
  const reduceMotion = useReducedMotion()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')

  const ask = useMutation({
    mutationFn: async (prompt: string) => {
      if (!supabaseBrowserClient) throw new Error('no_client')
      const res = await invokeAiRouter(supabaseBrowserClient, {
        intent: 'hq_roi_copilot',
        prompt,
        locale: locale === 'ar' ? 'ar' : 'en',
      })
      if (res.error) throw res.error
      return String((res.data as { answer?: unknown })?.answer ?? '')
    },
    onMutate: (prompt) => {
      setMessages((prev) => [...prev, { role: 'user', text: prompt }])
      setInput('')
    },
    onSuccess: (answer) => {
      setMessages((prev) => [...prev, { role: 'assistant', text: answer }])
    },
    onError: () => {
      toast.error(t('hq.roi.copilot.error'))
    },
  })

  const send = useCallback(
    (text: string) => {
      const p = text.trim()
      if (p.length < 2 || ask.isPending) return
      void ask.mutateAsync(p)
    },
    [ask],
  )

  return (
    <motion.section
      initial={reduceMotion ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 26, delay: 0.15 }}
      className="relative overflow-hidden rounded-[1.75rem] border border-white/12 bg-zinc-950/65 backdrop-blur-2xl"
    >
      {/* Pulsing AI border */}
      <motion.div
        className="pointer-events-none absolute -inset-px rounded-[1.75rem] opacity-90"
        style={{
          background:
            'conic-gradient(from 0deg, color-mix(in oklab, var(--brand-primary) 55%, transparent), #a855f7, color-mix(in oklab, var(--brand-secondary) 45%, transparent), color-mix(in oklab, var(--brand-primary) 55%, transparent))',
        }}
        animate={reduceMotion ? undefined : { rotate: 360 }}
        transition={reduceMotion ? undefined : { duration: 14, repeat: Infinity, ease: 'linear' }}
        aria-hidden
      />
      <motion.div
        className="pointer-events-none absolute inset-[1px] rounded-[calc(1.75rem-1px)] bg-zinc-950/92"
        aria-hidden
      />

      <motion.div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            'radial-gradient(80% 50% at 50% 0%, color-mix(in oklab, var(--brand-primary) 18%, transparent), transparent 60%)',
        }}
        animate={reduceMotion ? undefined : { opacity: [0.5, 0.85, 0.5] }}
        transition={reduceMotion ? undefined : { duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        aria-hidden
      />

      <motion.div className="relative flex flex-col">
        <header className="flex items-center gap-3 border-b border-white/8 px-6 py-5">
          <div className="relative grid size-11 place-items-center rounded-2xl bg-[linear-gradient(135deg,var(--brand-primary),#9333ea)] text-black shadow-[0_0_40px_-8px_var(--brand-glow)]">
            <Bot className="size-5" aria-hidden />
            <motion.span
              className="absolute -end-0.5 -top-0.5 size-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.9)]"
              animate={reduceMotion ? undefined : { scale: [1, 1.35, 1] }}
              transition={reduceMotion ? undefined : { duration: 1.8, repeat: Infinity }}
              aria-hidden
            />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.45em] text-white/45">
              {t('hq.roi.copilot.kicker')}
            </p>
            <h3 className="text-lg font-semibold text-white">{t('hq.roi.copilot.title')}</h3>
            <p className="text-xs text-white/50">{t('hq.roi.copilot.subtitle')}</p>
          </div>
        </header>

        <ScrollArea className="h-[min(420px,50vh)] px-6 py-4">
          {messages.length === 0 ? (
            <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-3 text-center">
              <Sparkles className="size-8 text-(--brand-primary) opacity-80" aria-hidden />
              <p className="max-w-sm text-sm leading-relaxed text-white/55">{t('hq.roi.copilot.empty')}</p>
            </div>
          ) : (
            <div className="space-y-4">
              <AnimatePresence initial={false}>
                {messages.map((m, idx) => (
                  <motion.div
                    key={`${idx}-${m.role}`}
                    initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn(
                      'rounded-2xl border px-4 py-3',
                      m.role === 'user'
                        ? 'ms-8 border-white/12 bg-white/[0.04]'
                        : 'me-4 border-[color-mix(in_oklab,var(--brand-primary)_35%,white)] bg-[color-mix(in_oklab,var(--brand-primary)_8%,transparent)]',
                    )}
                  >
                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-white/40">
                      {m.role === 'user' ? t('hq.ai.you') : t('hq.roi.copilot.assistant')}
                    </p>
                    {m.role === 'assistant' ? (
                      <RenderAiMarkdown text={m.text} />
                    ) : (
                      <p className="text-sm text-white/90">{m.text}</p>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
              {ask.isPending ? (
                <div className="flex items-center gap-2 text-xs text-white/45">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  {t('hq.ai.thinking')}
                </div>
              ) : null}
            </div>
          )}
        </ScrollArea>

        <footer className="space-y-3 border-t border-white/8 px-6 py-4">
          <motion.div className="flex flex-wrap gap-2">
            {QUICK_PROMPTS.map((chip) => (
              <button
                key={chip.id}
                type="button"
                disabled={ask.isPending}
                onClick={() => send(t(chip.key))}
                className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-medium text-white/75 transition hover:border-(--brand-primary)/40 hover:bg-[color-mix(in_oklab,var(--brand-primary)_12%,transparent)] disabled:opacity-50"
              >
                {t(chip.key)}
              </button>
            ))}
          </motion.div>

          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send(input)
                }
              }}
              placeholder={t('hq.roi.copilot.inputPlaceholder')}
              className="h-11 flex-1 rounded-xl border border-white/10 bg-black/50 px-4 text-sm text-white placeholder:text-white/35 focus:border-(--brand-primary)/40 focus:outline-none focus:ring-2 focus:ring-(--brand-primary)/20"
            />
            <Button
              type="button"
              size="icon"
              disabled={ask.isPending || input.trim().length < 2}
              onClick={() => send(input)}
              className="size-11 shrink-0 rounded-xl bg-[linear-gradient(135deg,var(--brand-primary),#9333ea)] text-black hover:opacity-90"
            >
              <Send className="size-4" aria-hidden />
            </Button>
          </div>
        </footer>
      </motion.div>
    </motion.section>
  )
}
