"use client";

import React from "react";
import { useRoleContext } from "@/providers/RoleProvider";
import { Role } from "@/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { LogOut, Menu, Search, Network } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { SidebarContent } from "./Sidebar";

export function Header() {
  const { currentUser, switchRole, logout } = useRoleContext();

  const roles: Role[] = ["Super Admin", "Admin", "Team Leader", "Employee"];

  if (!currentUser) {
    return null;
  }

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-gray-200 px-6 bg-white shadow-[0_1px_2px_0_rgba(0,0,0,0.03)] z-20 relative">
      <div className="flex items-center gap-4 lg:hidden">
        <Sheet>
          <SheetTrigger>
            <Button variant="ghost" size="icon" className="shrink-0 -ml-2 hover:bg-slate-100">
              <Menu className="h-5 w-5" />
              <span className="sr-only">Toggle navigation menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[280px] p-0 border-r-0">
            <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
            <SidebarContent />
          </SheetContent>
        </Sheet>
        
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-brand text-white">
            <Network className="h-4 w-4" />
          </div>
          <span className="font-bold text-lg tracking-tight text-slate-900 hidden sm:inline-flex">Tatwir Talent</span>
        </div>
      </div>
      
      <div className="hidden lg:flex lg:flex-1">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            type="search"
            placeholder="Search employees, departments, or shifts..."
            className="w-full bg-muted border-none shadow-none pl-9 py-2 hover:bg-gray-100 focus-visible:bg-gray-100 focus-visible:ring-1 focus-visible:ring-brand transition-colors h-9"
          />
        </div>
      </div>

      <div className="flex items-center gap-4 ml-4">
        <div className="hidden sm:flex items-center mx-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-brand bg-brand-light px-2.5 py-1 rounded-full">
            {currentUser.role} View
          </span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger>
            <Button variant="ghost" className="relative h-8 w-8 rounded-full">
              <Avatar className="h-9 w-9">
                <AvatarFallback>{currentUser.name.charAt(0)}</AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{currentUser.name}</p>
                <p className="text-xs leading-none text-muted-foreground">
                  {currentUser.email}
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Simulate Role</DropdownMenuLabel>
            {roles.map((role) => (
              <DropdownMenuItem
                key={role}
                onClick={() => switchRole(role)}
                className="cursor-pointer"
              >
                 {currentUser.role === role ? "✓ " : ""} {role}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout} className="cursor-pointer text-red-600">
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
