"use client";

import React, { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Role, User } from "@/types";

interface RoleContextProps {
  currentUser: User | null;
  loading: boolean;
  login: (input: { email: string; password: string }) => Promise<{ success: boolean; message: string }>;
  logout: () => Promise<void>;
  switchRole: (role: Role) => void;
  supabaseUser: null;
}

const RoleContext = createContext<RoleContextProps | undefined>(undefined);

/**
 * Hardcoded user credentials for demo/production use.
 */
const CREDENTIALS: { email: string; password: string; user: User }[] = [
  {
    email: "superadmin1234@gmail.com",
    password: "superadmin",
    user: {
      id: "sa-001",
      name: "Super Admin",
      email: "superadmin1234@gmail.com",
      role: "Super Admin",
      orgId: "org-tatwir-001",
    },
  },
  {
    email: "admin@tatwir.com",
    password: "admin1234",
    user: {
      id: "adm-001",
      name: "Ahmed Al-Rashid",
      email: "admin@tatwir.com",
      role: "Admin",
      orgId: "org-tatwir-001",
    },
  },
  {
    email: "leader@tatwir.com",
    password: "leader1234",
    user: {
      id: "tl-001",
      name: "Tariq Ali",
      email: "leader@tatwir.com",
      role: "Team Leader",
      orgId: "org-tatwir-001",
    },
  },
  {
    email: "employee@tatwir.com",
    password: "employee1234",
    user: {
      id: "emp-001",
      name: "Omar Zaid",
      email: "employee@tatwir.com",
      role: "Employee",
      orgId: "org-tatwir-001",
    },
  },
];

const STORAGE_KEY = "tatwir_hrms_user";

export function RoleProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * On mount, restore session from localStorage.
   */
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setCurrentUser(JSON.parse(stored));
      }
    } catch {
      // Ignore parse errors
    }
    setLoading(false);
  }, []);

  /**
   * Login with email + password against hardcoded credentials.
   */
  const login = async (input: { email: string; password: string }): Promise<{ success: boolean; message: string }> => {
    const match = CREDENTIALS.find(
      (c) => c.email.toLowerCase() === input.email.toLowerCase() && c.password === input.password
    );

    if (!match) {
      return { success: false, message: "Invalid email or password." };
    }

    setCurrentUser(match.user);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(match.user));
    return { success: true, message: "Login successful!" };
  };

  /**
   * Sign out — clears localStorage session.
   */
  const logout = async () => {
    setCurrentUser(null);
    localStorage.removeItem(STORAGE_KEY);
  };

  /**
   * Switch role (admin feature for testing).
   */
  const switchRole = (role: Role) => {
    if (!currentUser) return;
    const updated = { ...currentUser, role };
    setCurrentUser(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  };

  return (
    <RoleContext.Provider value={{ currentUser, loading, login, logout, switchRole, supabaseUser: null }}>
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
