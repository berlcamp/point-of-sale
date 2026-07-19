"use client";

import { Modal } from "@/components/Modal";

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "primary";
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
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  const confirmCls =
    variant === "danger"
      ? "bg-red-600 hover:bg-red-500"
      : "bg-blue-700 hover:bg-blue-600";

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
            className={`px-4 py-2 rounded-lg text-white ${confirmCls}`}
          >
            {confirmLabel}
          </button>
        </div>
      }
    >
      <p className="text-sm text-gray-700">{message}</p>
    </Modal>
  );
}
