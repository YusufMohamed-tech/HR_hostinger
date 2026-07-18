"use client";

export interface CarrierFilters {
  month: string;
  region: string;
  channel: string;
  supervisorId: string;
  segmentBrand: string;
  selectedDates: string[];
}

interface FilterSidebarProps {
  filters: CarrierFilters;
  availableDates?: string[];
  availableRegions?: string[];
  availableSupervisors?: { id: string; name: string }[];
  onChange: (filters: CarrierFilters) => void;
}

const CHANNELS = ["Direct Sales", "Modern trade"];
const REGIONS = ["Central", "Eastern", "Southern", "Western"];
const BRANDS = ["Virgin Mobile", "FRiENDi mobile"];

export function FilterSidebar({
  filters,
  availableDates = [],
  availableSupervisors = [],
  onChange,
}: FilterSidebarProps) {
  function set(patch: Partial<CarrierFilters>) {
    onChange({ ...filters, ...patch });
  }

  function toggleDate(date: string) {
    const next = filters.selectedDates.includes(date)
      ? filters.selectedDates.filter((d) => d !== date)
      : [...filters.selectedDates, date];
    set({ selectedDates: next });
  }

  return (
    <aside
      className="w-[200px] shrink-0 bg-[#16213e] border-r border-[#0f3460] overflow-y-auto h-full py-4 px-3 flex flex-col gap-5"
      style={{ minHeight: 0 }}
    >
      {/* Month */}
      <div>
        <div className="text-xs text-[#94a3b8] mb-1 uppercase tracking-wide">Month</div>
        <input
          type="month"
          value={filters.month}
          onChange={(e) => set({ month: e.target.value })}
          className="w-full bg-[#0f3460] text-white text-sm rounded px-2 py-1.5 border border-[#1e4080] focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Supervisor */}
      {availableSupervisors.length > 0 && (
        <div>
          <div className="text-xs text-[#94a3b8] mb-1 uppercase tracking-wide">Supervisor</div>
          <select
            value={filters.supervisorId}
            onChange={(e) => set({ supervisorId: e.target.value })}
            className="w-full bg-[#0f3460] text-white text-sm rounded px-2 py-1.5 border border-[#1e4080] focus:outline-none"
          >
            <option value="">All</option>
            {availableSupervisors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Brand */}
      <div>
        <div className="text-xs text-[#94a3b8] mb-1 uppercase tracking-wide">Brand</div>
        {BRANDS.map((brand) => (
          <label key={brand} className="flex items-center gap-2 py-0.5 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.segmentBrand === brand}
              onChange={() => set({ segmentBrand: filters.segmentBrand === brand ? "" : brand })}
              className="accent-blue-500"
            />
            <span className="text-sm text-white">{brand}</span>
          </label>
        ))}
      </div>

      {/* Channel */}
      <div>
        <div className="text-xs text-[#94a3b8] mb-1 uppercase tracking-wide">Channel</div>
        {CHANNELS.map((ch) => (
          <label key={ch} className="flex items-center gap-2 py-0.5 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.channel === ch}
              onChange={() => set({ channel: filters.channel === ch ? "" : ch })}
              className="accent-blue-500"
            />
            <span className="text-sm text-white">{ch}</span>
          </label>
        ))}
      </div>

      {/* Region */}
      <div>
        <div className="text-xs text-[#94a3b8] mb-1 uppercase tracking-wide">Region</div>
        {REGIONS.map((r) => (
          <label key={r} className="flex items-center gap-2 py-0.5 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.region === r}
              onChange={() => set({ region: filters.region === r ? "" : r })}
              className="accent-blue-500"
            />
            <span className="text-sm text-white">{r}</span>
          </label>
        ))}
      </div>

      {/* Dates */}
      {availableDates.length > 0 && (
        <div>
          <div className="text-xs text-[#94a3b8] mb-1 uppercase tracking-wide flex justify-between items-center">
            <span>Dates</span>
            {filters.selectedDates.length > 0 && (
              <button
                onClick={() => set({ selectedDates: [] })}
                className="text-blue-400 text-xs hover:underline"
              >
                Clear
              </button>
            )}
          </div>
          <div className="max-h-48 overflow-y-auto space-y-0.5">
            {availableDates.map((d) => (
              <label key={d} className="flex items-center gap-2 py-0.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.selectedDates.includes(d)}
                  onChange={() => toggleDate(d)}
                  className="accent-blue-500"
                />
                <span className="text-xs text-white">
                  {new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Clear all */}
      <button
        onClick={() =>
          onChange({
            month: filters.month,
            region: "",
            channel: "",
            supervisorId: "",
            segmentBrand: "",
            selectedDates: [],
          })
        }
        className="mt-auto text-xs text-[#94a3b8] hover:text-white border border-[#0f3460] rounded px-2 py-1.5"
      >
        Clear Filters
      </button>
    </aside>
  );
}
