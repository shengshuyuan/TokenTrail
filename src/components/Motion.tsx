'use client'

import {
  createElement,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from 'react'

type MotionElement = 'div' | 'main' | 'section'

interface MotionGroupProps {
  as?: MotionElement
  children: ReactNode
  className?: string
  threshold?: number
}

interface MotionItemProps {
  as?: MotionElement
  children: ReactNode
  className?: string
  index?: number
}

/**
 * 共享的显现容器。皮肤仅通过 CSS 动效令牌改变节奏，不包含业务逻辑。
 */
export function MotionGroup({
  as = 'div',
  children,
  className = '',
  threshold = 0.08,
}: MotionGroupProps) {
  const rootRef = useRef<HTMLElement | null>(null)
  const [ready, setReady] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    setReady(true)
    const element = rootRef.current
    if (!element || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }

    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { threshold }
    )

    observer.observe(element)
    return () => observer.disconnect()
  }, [threshold])

  return createElement(
    as as ElementType,
    {
      ref: rootRef,
      className: `motion-group ${className}`.trim(),
      'data-motion-ready': ready,
      'data-motion-visible': visible,
    },
    children
  )
}

/**
 * MotionGroup 的子项，通过 index 获取错峰延迟。
 */
export function MotionItem({
  as = 'div',
  children,
  className = '',
  index = 0,
}: MotionItemProps) {
  const style = {
    '--motion-index': index,
  } as CSSProperties

  return createElement(
    as as ElementType,
    {
      className: `motion-item ${className}`.trim(),
      style,
    },
    children
  )
}
