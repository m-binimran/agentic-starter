interface Props {
  onClick: () => void
  /** When true the pill rests quietly (silent mode) — bars don't animate. */
  idle?: boolean
  /** When true Agentic Starter is processing — show the loading dots instead of the bars. */
  thinking?: boolean
}

/**
 * Minimal Mac-style pill (Dynamic Island feel) that lives at the top-center.
 * Click it, press Alt+J, or say "Hey Agentic Starter" to expand into the app.
 *
 * Right side shows one of two indicators:
 *   - thinking → three dots bouncing up and down (Agentic Starter is working)
 *   - otherwise → the mini waveform bars (idle/listening)
 */
export function Bubble({ onClick, idle = false, thinking = false }: Props) {
  return (
    <div
      className={`pill${idle ? ' idle' : ''}${thinking ? ' thinking' : ''}`}
      onClick={onClick}
      title="Open Agentic Starter — click, press Alt+J, or say 'Hey Agentic Starter'"
    >
      <span className="pill-dot" />
      <span className="pill-label">Agentic Starter</span>
      {thinking
        ? <span className="pill-loader" aria-label="Agentic Starter is thinking"><i /><i /><i /></span>
        : <span className="pill-bars"><i /><i /><i /><i /></span>}
    </div>
  )
}
