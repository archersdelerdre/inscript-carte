/** French regions and their départements, to group and filter the calendar like the FFTA website does. */
export type Region = { readonly id: string; readonly name: string; readonly departments: readonly string[] };

/** Alphabetical, overseas last. Every code of `DEPARTMENT_NAMES` is in exactly one region. */
export const REGIONS: readonly Region[] = [
  {
    id: 'auvergne-rhone-alpes',
    name: 'Auvergne-Rhône-Alpes',
    departments: ['01', '03', '07', '15', '26', '38', '42', '43', '63', '69', '73', '74'],
  },
  {
    id: 'bourgogne-franche-comte',
    name: 'Bourgogne-Franche-Comté',
    departments: ['21', '25', '39', '58', '70', '71', '89', '90'],
  },
  { id: 'bretagne', name: 'Bretagne', departments: ['22', '29', '35', '56'] },
  { id: 'centre-val-de-loire', name: 'Centre-Val de Loire', departments: ['18', '28', '36', '37', '41', '45'] },
  { id: 'corse', name: 'Corse', departments: ['2A', '2B'] },
  {
    id: 'grand-est',
    name: 'Grand Est',
    departments: ['08', '10', '51', '52', '54', '55', '57', '67', '68', '88'],
  },
  { id: 'hauts-de-france', name: 'Hauts-de-France', departments: ['02', '59', '60', '62', '80'] },
  { id: 'ile-de-france', name: 'Île-de-France', departments: ['75', '77', '78', '91', '92', '93', '94', '95'] },
  { id: 'normandie', name: 'Normandie', departments: ['14', '27', '50', '61', '76'] },
  {
    id: 'nouvelle-aquitaine',
    name: 'Nouvelle-Aquitaine',
    departments: ['16', '17', '19', '23', '24', '33', '40', '47', '64', '79', '86', '87'],
  },
  {
    id: 'occitanie',
    name: 'Occitanie',
    departments: ['09', '11', '12', '30', '31', '32', '34', '46', '48', '65', '66', '81', '82'],
  },
  { id: 'pays-de-la-loire', name: 'Pays de la Loire', departments: ['44', '49', '53', '72', '85'] },
  {
    id: 'provence-alpes-cote-d-azur',
    name: "Provence-Alpes-Côte d'Azur",
    departments: ['04', '05', '06', '13', '83', '84'],
  },
  { id: 'outre-mer', name: 'Outre-mer', departments: ['971', '972', '973', '974', '976', '988'] },
];
