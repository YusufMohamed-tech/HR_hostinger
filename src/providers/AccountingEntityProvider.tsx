"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import type { AccountingLegalEntity, AccountingBook } from "@/types/accounting";
import { getAllowedEntities } from "@/lib/services/accounting";

interface AccountingEntityContextValue {
  currentEntity: AccountingLegalEntity | null;
  currentBook: AccountingBook | null;
  functionalCurrency: string;
  allowedEntities: AccountingLegalEntity[];
  switchEntity: (entityId: string) => void;
  isLoading: boolean;
  entityHeader: string | null;
}

const AccountingEntityContext = createContext<AccountingEntityContextValue>({
  currentEntity: null,
  currentBook: null,
  functionalCurrency: "SAR",
  allowedEntities: [],
  switchEntity: () => {},
  isLoading: true,
  entityHeader: null,
});

const STORAGE_KEY = "accounting_selected_entity";

export function AccountingEntityProvider({ children }: { children: ReactNode }) {
  const [allowedEntities, setAllowedEntities] = useState<AccountingLegalEntity[]>([]);
  const [currentEntity, setCurrentEntity] = useState<AccountingLegalEntity | null>(null);
  const [currentBook, setCurrentBook] = useState<AccountingBook | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function load() {
      const { data } = await getAllowedEntities();
      if (!mounted) return;

      const entities = data || [];
      setAllowedEntities(entities);

      if (entities.length === 0) {
        setIsLoading(false);
        return;
      }

      const savedId = localStorage.getItem(STORAGE_KEY);
      const saved = savedId ? entities.find((e) => e.id === savedId) : null;
      const selected = saved || entities.find((e) => e.is_default) || entities[0];

      setCurrentEntity(selected);
      setIsLoading(false);
    }

    load();
    return () => { mounted = false; };
  }, []);

  const switchEntity = useCallback(
    (entityId: string) => {
      const entity = allowedEntities.find((e) => e.id === entityId);
      if (!entity) return;
      setCurrentEntity(entity);
      setCurrentBook(null);
      localStorage.setItem(STORAGE_KEY, entityId);
    },
    [allowedEntities]
  );

  const functionalCurrency = currentEntity?.functional_currency_code || "SAR";
  const entityHeader = currentEntity?.id || null;

  return (
    <AccountingEntityContext.Provider
      value={{
        currentEntity,
        currentBook,
        functionalCurrency,
        allowedEntities,
        switchEntity,
        isLoading,
        entityHeader,
      }}
    >
      {children}
    </AccountingEntityContext.Provider>
  );
}

export function useAccountingEntity() {
  return useContext(AccountingEntityContext);
}
