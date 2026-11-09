/** Prepare local browser module layout identical to the published site.
 * The production workflow still copies dist/ into _site/dist/.
 */
import {cp,rm} from 'node:fs/promises';
await rm('web/dist',{recursive:true,force:true});
await cp('dist','web/dist',{recursive:true});
