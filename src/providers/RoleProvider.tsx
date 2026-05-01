"use client";

import React, { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Role, User } from "@/types";

interface RoleContextProps {
  currentUser: User | null;
  loading: boolean;
  login: (input: { email: string; role: Role; name?: string }) => void;
  logout: () => void;
  switchRole: (role: Role) => void;
}

const AUTH_STORAGE_KEY = "tatwir.auth";

const defaultUsers: Record<Role, User> = {
  "Super Admin": {
    id: "user-super",
    name: "Alex (Super Admin)",
    email: "alex@master.com",
    role: "Super Admin",
    orgId: "org-master",
  },
  Admin: {
    id: "user-admin",
    name: "Sarah (Company Admin)",
    email: "sarah@acme.com",
    role: "Admin",
    orgId: "org-acme",
  },
  "Team Leader": {
    id: "user-manager",
    name: "David (Team Lead)",
    email: "david@acme.com",
    role: "Team Leader",
    orgId: "org-acme",
  },
  Employee: {
    id: "user-emp",
    name: "Jane (Employee)",
    email: "jane@acme.com",
    role: "Employee",
    orgId: "org-acme",
  },
};

const RoleContext = createContext<RoleContextProps | undefined>(undefined);

export function RoleProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as User;
        setCurrentUser(parsed);
      } catch {
        window.localStorage.removeItem(AUTH_STORAGE_KEY);
      }
    }
    setLoading(false);
  }, []);

  const persistUser = (user: User | null) => {
    if (!user) {
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
  };

  const login = (input: { email: string; role: Role; name?: string }) => {
    const base = defaultUsers[input.role];
    const fallbackName = input.email?.split("@")[0] || base.name;
    const nextUser: User = {
      ...base,
      email: input.email || base.email,
      name: input.name?.trim() || fallbackName,
    };
    setCurrentUser(nextUser);
    persistUser(nextUser);
  };

  const logout = () => {
    setCurrentUser(null);
    persistUser(null);
  };

  const switchRole = (role: Role) => {
    const base = defaultUsers[role];
    const nextUser: User = {
      ...base,
      email: currentUser?.email || base.email,
      name: currentUser?.name || base.name,
    };
    setCurrentUser(nextUser);
    persistUser(nextUser);
  };

  return (
    <RoleContext.Provider value={{ currentUser, loading, login, logout, switchRole }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRoleContext() {
  const context = useContext(RoleContext);
  if (!context) {
    throw new Error("useRoleContext must be used within a RoleProvider");
  }
  return context;
}
