"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton } from "@/components/SignOutButton";
import type { Role } from "@/lib/types";
import {
  LayoutDashboard,
  Package,
  Warehouse,
  TrendingUp,
  ScrollText,
  Users,
  Settings,
  Store,
} from "lucide-react";

const navItems = [
  { href: "/admin", label: "Dashboard", Icon: LayoutDashboard, roles: ["admin", "manager"] },
  { href: "/admin/products", label: "Products", Icon: Package, roles: ["admin", "manager"] },
  { href: "/admin/inventory", label: "Inventory", Icon: Warehouse, roles: ["admin", "manager"] },
  { href: "/admin/reports", label: "Reports", Icon: TrendingUp, roles: ["admin", "manager"] },
  { href: "/admin/audit", label: "Audit Log", Icon: ScrollText, roles: ["admin"] },
  { href: "/admin/users", label: "Users", Icon: Users, roles: ["admin"] },
  { href: "/admin/settings", label: "Settings", Icon: Settings, roles: ["admin"] },
];

export function AdminSidebar({
  role,
  name,
  companyName,
}: {
  role: Role;
  name: string;
  companyName: string;
}) {
  const pathname = usePathname();

  return (
    <aside className="w-56 bg-blue-800 text-white flex flex-col shrink-0">
      <div className="px-4 py-5 border-b border-blue-700">
        <h1 className="font-bold text-sm leading-tight">{companyName}</h1>
        <p className="text-blue-300 text-xs mt-1">Admin Panel</p>
      </div>

      <nav className="flex-1 py-4 space-y-1 px-2">
        {navItems
          .filter((i) => i.roles.includes(role))
          .map(({ href, label, Icon }) => {
            const isActive = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition ${
                  isActive ? "bg-blue-600 text-white" : "text-blue-100 hover:bg-blue-700"
                }`}
              >
                <Icon size={18} />
                {label}
              </Link>
            );
          })}
      </nav>

      <div className="p-4 border-t border-blue-700">
        <div className="text-xs text-blue-200 mb-0.5">{name}</div>
        <div className="text-xs text-blue-400 mb-3 capitalize">{role}</div>
        <div className="flex gap-2">
          <Link
            href="/"
            className="flex-1 flex items-center justify-center gap-1 text-xs bg-blue-700 hover:bg-blue-600 px-2 py-1.5 rounded text-blue-100 transition"
          >
            <Store size={14} /> POS
          </Link>
          <SignOutButton className="flex-1 flex items-center justify-center gap-1 text-xs bg-red-700 hover:bg-red-600 px-2 py-1.5 rounded text-white transition" />
        </div>
      </div>
    </aside>
  );
}
