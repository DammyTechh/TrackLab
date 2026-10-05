import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { db } from '@/offline/db';
import type { EquipmentStatus } from '@/lib/status';

export interface EquipmentListItem {
  id: string;
  qr_token: string;
  lab_id: string;
  asset_id: string;
  name: string;
  location: string | null;
  photo_path: string | null;
  status: EquipmentStatus;
  next_service_due: string | null;
  lab: { name: string; code: string } | null;
}

/**
 * Every machine this person may see. RLS decides the scope, not this code:
 * a technician or HOD gets their own labs, a senior leader gets everything.
 * Falls back to the device copy when the server cannot be reached.
 */
export function useMyEquipment() {
  return useQuery({
    queryKey: ['my-equipment'],
    queryFn: async (): Promise<{ items: EquipmentListItem[]; fromCache: boolean }> => {
      const { data, error } = await supabase
        .from('equipment')
        .select('id, qr_token, lab_id, asset_id, name, location, photo_path, status, next_service_due, lab:labs(name, code)')
        .order('name');

      if (!error && data) return { items: data as unknown as EquipmentListItem[], fromCache: false };

      const cached = await db.equipment.orderBy('next_service_due').toArray();
      return {
        items: cached
          .map((row) => ({ ...row, lab: null }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        fromCache: true,
      };
    },
  });
}
