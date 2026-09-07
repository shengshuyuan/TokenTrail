'use client'

import React from 'react'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: React.ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  children,
  className = '',
  disabled,
  ...props
}: ButtonProps) {
  const sizeClasses = {
    sm: 'h-8 px-2.5 text-xs gap-1.5',
    md: 'h-9 px-3.5 text-sm gap-2',
    lg: 'h-10 px-4 text-base gap-2.5',
  }[size]

  const variantClasses = {
    primary:
      'bg-workbench-accent text-white hover:bg-workbench-accent-hover shadow-sm border border-transparent active:opacity-95',
    secondary:
      'bg-workbench-surface text-workbench-text hover:bg-workbench-sidebar border border-workbench-border shadow-xs active:bg-gray-100',
    outline:
      'bg-transparent text-workbench-text hover:bg-workbench-sidebar border border-workbench-border',
    ghost:
      'bg-transparent text-workbench-text-muted hover:text-workbench-text hover:bg-workbench-sidebar border border-transparent',
    danger:
      'bg-red-600 text-white hover:bg-red-700 shadow-sm border border-transparent',
  }[variant]

  return (
    <button
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center font-medium rounded-lg transition-colors duration-150 select-none focus:outline-none focus:ring-2 focus:ring-workbench-accent/20 disabled:opacity-50 disabled:cursor-not-allowed ${sizeClasses} ${variantClasses} ${className}`}
      {...props}
    >
      {loading ? (
        <svg
          className="animate-spin -ml-0.5 h-4 w-4 text-current"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      ) : (
        icon
      )}
      <span>{children}</span>
    </button>
  )
}
