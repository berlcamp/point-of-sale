"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "primary";
  // When set, the confirm button stays disabled until the user types this exact text.
  requireText?: string;
  onConfirm: () => void;
  onClose: () => void;
}

// Shared confirmation dialog — replaces the native window.confirm() prompt.
export function ConfirmModal({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "primary",
  requireText,
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  const [typed, setTyped] = useState("");
  const confirmCls =
    variant === "danger"
      ? "bg-red-600 hover:bg-red-500"
      : "bg-blue-700 hover:bg-blue-600";
  const disabled = requireText != null && typed !== requireText;

  return (
    <Modal
      title={title}
      onClose={onClose}
      maxWidth="max-w-md"
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={disabled}
            className={`px-4 py-2 rounded-lg text-white disabled:opacity-50 disabled:cursor-not-allowed ${confirmCls}`}
          >
            {confirmLabel}
          </button>
        </div>
      }
    >
      <p className="text-sm text-gray-700">{message}</p>
      {requireText != null && (
        <div className="mt-4">
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Type <span className="font-code font-semibold text-gray-700">{requireText}</span> to
            confirm
          </label>
          <input
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={requireText}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
          />
        </div>
      )}
    </Modal>
  );
}
