import { makeDispatchHandler } from '../_shared/whatsapp.ts';
import { serviceRpc } from '../_shared/service-rpc.ts';

// JWT utilisateur désactivé uniquement pour ce point d'entrée serveur-à-serveur ;
// makeDispatchHandler exige le secret de l'ordonnanceur avant tout traitement.
Deno.serve(makeDispatchHandler((name) => Deno.env.get(name), serviceRpc));
