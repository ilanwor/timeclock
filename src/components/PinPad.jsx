/**
 * PinPad — numeric keypad for PIN entry.
 *
 * Layout:
 *   1  2  3
 *   4  5  6
 *   7  8  9
 *   ⌫  0  ✓
 *
 * The ✓ key submits the entered PIN and is enabled only when
 * value.length >= minLength. There is no auto-submit; the user
 * must press ✓ explicitly (supports variable-length PINs 4–10+).
 */

export default function PinPad({
  value    = '',
  onChange,
  onComplete,
  maxLength = 10,
  minLength = 4,
  disabled  = false,
}) {
  const canSubmit = value.length >= minLength && !disabled

  function handleKey(key) {
    if (disabled) return
    if (key === '⌫') { onChange(value.slice(0, -1)); return }
    if (key === '✓') { if (canSubmit) onComplete?.(value); return }
    if (value.length >= maxLength) return
    onChange(value + key)
  }

  const ROWS = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['⌫', '0', '✓'],
  ]

  return (
    <div className="select-none w-full">
      {/* PIN dot display */}
      <div className="flex justify-center gap-3 mb-6">
        {Array.from({ length: Math.min(maxLength, 10) }).map((_, i) => (
          <div
            key={i}
            className={`rounded-full border-2 transition-all duration-150 ${
              i < value.length
                ? 'w-4 h-4 bg-blue-400 border-blue-400 scale-110'
                : 'w-3.5 h-3.5 bg-transparent border-slate-500'
            }`}
          />
        ))}
      </div>

      {/* Keypad */}
      <div className="grid grid-cols-3 gap-3">
        {ROWS.flat().map((key) => {
          const isSubmit    = key === '✓'
          const isBackspace = key === '⌫'
          const isDisabled  = disabled || (isSubmit && !canSubmit)

          return (
            <button
              key={key}
              onClick={() => handleKey(key)}
              disabled={isDisabled}
              className={`
                h-16 rounded-xl text-xl font-semibold transition-all duration-100
                active:scale-95 focus:outline-none
                ${isSubmit
                  ? canSubmit
                    ? 'bg-blue-600 hover:bg-blue-500 text-white'
                    : 'bg-slate-700/50 text-slate-600 cursor-not-allowed'
                  : isBackspace
                    ? 'bg-slate-700 hover:bg-slate-600 text-slate-300 text-2xl'
                    : 'bg-slate-700 hover:bg-slate-600 text-white'
                }
                ${isDisabled && !isSubmit ? 'opacity-40 cursor-not-allowed' : ''}
              `}
            >
              {key}
            </button>
          )
        })}
      </div>

      {/* Character count hint */}
      {value.length > 0 && value.length < minLength && (
        <p className="text-center text-xs text-slate-500 mt-3">
          {minLength - value.length} more digit{minLength - value.length !== 1 ? 's' : ''} needed
        </p>
      )}
    </div>
  )
}
