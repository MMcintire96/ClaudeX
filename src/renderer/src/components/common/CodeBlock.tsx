import React, { ReactNode, useCallback } from 'react'

interface Props {
  language?: string
  children: ReactNode
  copyText?: string
}

export default function CodeBlock({ language, children, copyText }: Props) {
  const handleCopy = useCallback(() => {
    const text = copyText ?? (typeof children === 'string' ? children : '')
    navigator.clipboard.writeText(text)
  }, [children, copyText])

  return (
    <div className="code-block">
      <div className="code-block-header">
        {language && <span className="code-lang">{language}</span>}
        <button className="btn-copy" onClick={handleCopy} title="Copy">
          Copy
        </button>
      </div>
      <pre>
        <code className={language ? `language-${language}` : ''}>
          {children}
        </code>
      </pre>
    </div>
  )
}
