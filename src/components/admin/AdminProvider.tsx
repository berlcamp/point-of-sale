"use client";

import { createContext, useContext } from "react";
import type { Role } from "@/lib/types";

interface AdminContextValue {
  companyId: string;
  companyName: string;
  currency: string;
  role: Role;
  userId: string;
  userName: string;
}

const AdminContext = createContext<AdminContextValue | null>(null);

export function AdminProvider({
  value,
  children,
}: {
  value: AdminContextValue;
  children: React.ReactNode;
}) {
  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdmin() {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin must be used within AdminProvider");
  return ctx;
}
