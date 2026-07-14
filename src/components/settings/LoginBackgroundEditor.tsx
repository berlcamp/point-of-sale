"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ImagePlus, Loader2, Trash2, ExternalLink } from "lucide-react";

const BUCKET = "pos-company-assets";
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

// Uploads / removes a company's login-screen background image. Used by both
// the company admin settings page and the super admin company editor.
export function LoginBackgroundEditor({
  companyId,
  slug,
  initialBgUrl,
  onChange,
}: {
  companyId: string;
  slug: string;
  initialBgUrl: string | null;
  onChange?: (url: string | null) => void;
}) {
  const supabase = createClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [bgUrl, setBgUrl] = useState<string | null>(initialBgUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fixed key per company so a new upload overwrites the previous file
  // (no orphaned objects); the ?v= cache-buster forces browsers to refetch.
  const storageKey = `${companyId}/login-bg`;

  const apply = (url: string | null) => {
    setBgUrl(url);
    onChange?.(url);
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Image must be under 5 MB.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(storageKey, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;

      const {
        data: { publicUrl },
      } = supabase.storage.from(BUCKET).getPublicUrl(storageKey);
      const versioned = `${publicUrl}?v=${Date.now()}`;

      const { error: dbErr } = await supabase
        .from("companies")
        .update({ login_bg_url: versioned })
        .eq("id", companyId);
      if (dbErr) throw dbErr;

      apply(versioned);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async () => {
    setBusy(true);
    setError(null);
    try {
      await supabase.storage.from(BUCKET).remove([storageKey]);
      const { error: dbErr } = await supabase
        .from("companies")
        .update({ login_bg_url: null })
        .eq("id", companyId);
      if (dbErr) throw dbErr;
      apply(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="relative aspect-[16/9] w-full rounded-xl border border-gray-200 overflow-hidden bg-gray-50">
        {bgUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={bgUrl}
              alt="Login background preview"
              className="absolute inset-0 h-full w-full object-cover"
            />
            {/* Mirrors the darkened overlay applied on the real login page. */}
            <div className="absolute inset-0 bg-black/60" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="bg-white rounded-lg px-4 py-2 text-sm font-semibold text-gray-800 shadow">
                PointOne POS
              </div>
            </div>
          </>
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-blue-700 to-blue-900 flex items-center justify-center">
            <div className="bg-white rounded-lg px-4 py-2 text-sm font-semibold text-gray-800 shadow">
              PointOne POS
            </div>
          </div>
        )}
        {busy && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <Loader2 className="animate-spin text-white" size={24} />
          </div>
        )}
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="flex items-center gap-2 bg-blue-700 hover:bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
        >
          <ImagePlus size={16} /> {bgUrl ? "Replace image" : "Upload image"}
        </button>
        {bgUrl && (
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            className="flex items-center gap-2 text-gray-600 hover:text-red-600 hover:bg-red-50 px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            <Trash2 size={16} /> Remove
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={onFile}
          className="hidden"
        />
      </div>

      <p className="text-xs text-gray-400">
        Shown behind the sign-in card at{" "}
        <a
          href={`/login/${slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-blue-600 hover:underline font-code"
        >
          /login/{slug} <ExternalLink size={12} />
        </a>
        . PNG or JPG, under 5 MB.
      </p>
    </div>
  );
}
