"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

interface ModalProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: string;
}

// Shared modal shell: blurred backdrop + gradient header + escape-to-close.
// Mirrors the reference app's modal pattern (globals.css animations).
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  maxWidth = "max-w-lg",
}: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(15,23,42,0.65)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className={`modal-panel w-full ${maxWidth} bg-white rounded-2xl shadow-2xl max-h-[90vh] flex flex-col overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-6 py-4 bg-gradient-to-r from-blue-700 to-blue-600 text-white">
          <div>
            <h2 className="text-lg font-bold">{title}</h2>
            {subtitle && <p className="text-blue-100 text-sm">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="text-blue-100 hover:text-white transition"
            aria-label="Close"
          >
            <X size={22} />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-6 py-5">{children}</div>

        {footer && (
          <div className="px-6 py-4 border-t border-gray-100 bg-gray-50">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
