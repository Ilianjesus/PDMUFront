import { getDashboardSummarySupabase } from "./supabaseBusiness/dashboardRepository";

export function getDashboardSummary() {
  return getDashboardSummarySupabase();
}
