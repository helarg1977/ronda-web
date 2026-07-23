import { createClient } from '@supabase/supabase-js'

// Reemplaza estos dos valores por los tuyos (Project Settings → API en Supabase)
const SUPABASE_URL = 'https://yuucexxhecryveiqirsg.supabase.co'
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_pNKdqpKXm3WhA52zM8FdLQ_qcCL8ooz'

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
