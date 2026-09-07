'use client'

import React from 'react'
import Link from 'next/link'
import { Button } from './Button'

export type EmptyStateType = 'first_load_no_data' | 'filter_no_results' | 'fetch_error'

interface EmptyStateProps {
  type?: EmptyStateType
  title?: string
  description?: string
  actionLabel?: string
  onAction?: () => void
  actionHref?: string
  className?: string
}

export function EmptyState({
  type = 'filter_no_results',
  title,
  description,
  actionLabel,
  onAction,
  actionHref,
  className = '',
}: EmptyStateProps) {
  const configs = {
    first_load_no_data: {
      defaultTitle: '暂无用量数据',
      defaultDesc: '尚未接入或同步任何 AI 工具的用量日志。前往数据接入页面查看支持的工具与同步方式。',
      defaultActionLabel: '前往数据接入',
      defaultHref: '/connections',
      icon: (
        <svg className="w-10 h-10 text-workbench-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7c0-2-1-3-3-3H7C5 4 4 5 4 7z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-3-3v6" />
        </svg>
      ),
    },
    filter_no_results: {
      defaultTitle: '当前筛选无匹配数据',
      defaultDesc: '在所选的时间窗口、数据来源或模型组合下未找到使用记录。尝试放宽或重置筛选条件。',
      defaultActionLabel: '清空筛选条件',
      defaultHref: undefined,
      icon: (
        <svg className="w-10 h-10 text-workbench-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
        </svg>
      ),
    },
    fetch_error: {
      defaultTitle: '数据获取失败',
      defaultDesc: '与本地服务通信遇到异常，请检查服务运行状态并稍后重试。',
      defaultActionLabel: '重新加载',
      defaultHref: undefined,
      icon: (
        <svg className="w-10 h-10 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      ),
    },
  }[type]

  const displayTitle = title || configs.defaultTitle
  const displayDesc = description || configs.defaultDesc
  const displayAction = actionLabel || configs.defaultActionLabel
  const targetHref = actionHref || configs.defaultHref

  return (
    <div className={`py-12 px-4 flex flex-col items-center justify-center text-center ${className}`}>
      <div className="w-16 h-16 rounded-full bg-workbench-sidebar border border-workbench-border flex items-center justify-center mb-4">
        {configs.icon}
      </div>
      <h3 className="text-base font-semibold text-workbench-text mb-1.5">{displayTitle}</h3>
      <p className="text-sm text-workbench-text-muted max-w-md mb-5 leading-relaxed">{displayDesc}</p>
      {targetHref ? (
        <Link href={targetHref}>
          <Button variant="primary" size="sm">
            {displayAction}
          </Button>
        </Link>
      ) : onAction ? (
        <Button variant={type === 'fetch_error' ? 'primary' : 'secondary'} size="sm" onClick={onAction}>
          {displayAction}
        </Button>
      ) : null}
    </div>
  )
}
