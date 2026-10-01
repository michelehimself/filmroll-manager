// Built-in film list: films that can be bought new today, sorted by manufacturer.
// The full name ("Kodak Portra 400") is what ends up in the Film field and in the
// image metadata – keep the speed at the end of the name so the ISO can be read from it.

const COLOR = "Color negative", SLIDE = "Color slide", BW = "Black & white";

const FILMS = [
  // Kodak
  { brand: "Kodak", name: "Gold 200",          iso: "200",  type: COLOR },
  { brand: "Kodak", name: "ColorPlus 200",     iso: "200",  type: COLOR },
  { brand: "Kodak", name: "UltraMax 400",      iso: "400",  type: COLOR },
  { brand: "Kodak", name: "Portra 160",        iso: "160",  type: COLOR },
  { brand: "Kodak", name: "Portra 400",        iso: "400",  type: COLOR },
  { brand: "Kodak", name: "Portra 800",        iso: "800",  type: COLOR },
  { brand: "Kodak", name: "Ektar 100",         iso: "100",  type: COLOR },
  { brand: "Kodak", name: "Ektachrome E100",   iso: "100",  type: SLIDE },
  { brand: "Kodak", name: "Tri-X 400",         iso: "400",  type: BW },
  { brand: "Kodak", name: "T-Max 100",         iso: "100",  type: BW },
  { brand: "Kodak", name: "T-Max 400",         iso: "400",  type: BW },
  { brand: "Kodak", name: "T-Max P3200",       iso: "3200", type: BW },
  { brand: "Kodak", name: "Vision3 50D",       iso: "50",   type: COLOR },
  { brand: "Kodak", name: "Vision3 250D",      iso: "250",  type: COLOR },
  { brand: "Kodak", name: "Vision3 200T",      iso: "200",  type: COLOR },
  { brand: "Kodak", name: "Vision3 500T",      iso: "500",  type: COLOR },
  // Ilford
  { brand: "Ilford", name: "HP5 Plus 400",     iso: "400",  type: BW },
  { brand: "Ilford", name: "FP4 Plus 125",     iso: "125",  type: BW },
  { brand: "Ilford", name: "Delta 100",        iso: "100",  type: BW },
  { brand: "Ilford", name: "Delta 400",        iso: "400",  type: BW },
  { brand: "Ilford", name: "Delta 3200",       iso: "3200", type: BW },
  { brand: "Ilford", name: "Pan F Plus 50",    iso: "50",   type: BW },
  { brand: "Ilford", name: "XP2 Super 400",    iso: "400",  type: BW },
  { brand: "Ilford", name: "SFX 200",          iso: "200",  type: BW },
  { brand: "Ilford", name: "Ortho Plus 80",    iso: "80",   type: BW },
  // Fujifilm
  { brand: "Fujifilm", name: "Superia X-TRA 400", iso: "400", type: COLOR },
  { brand: "Fujifilm", name: "Fujicolor C200",    iso: "200", type: COLOR },
  { brand: "Fujifilm", name: "Velvia 50",         iso: "50",  type: SLIDE },
  { brand: "Fujifilm", name: "Velvia 100",        iso: "100", type: SLIDE },
  { brand: "Fujifilm", name: "Provia 100F",       iso: "100", type: SLIDE },
  { brand: "Fujifilm", name: "Acros 100 II",      iso: "100", type: BW },
  // Cinestill
  { brand: "Cinestill", name: "50D",          iso: "50",  type: COLOR },
  { brand: "Cinestill", name: "400D",         iso: "400", type: COLOR },
  { brand: "Cinestill", name: "800T",         iso: "800", type: COLOR },
  { brand: "Cinestill", name: "BwXX 250",     iso: "250", type: BW },
  // Lomography
  { brand: "Lomography", name: "Color Negative 100",       iso: "100",     type: COLOR },
  { brand: "Lomography", name: "Color Negative 400",       iso: "400",     type: COLOR },
  { brand: "Lomography", name: "Color Negative 800",       iso: "800",     type: COLOR },
  { brand: "Lomography", name: "Berlin Kino 400",          iso: "400",     type: BW },
  { brand: "Lomography", name: "Earl Grey 100",            iso: "100",     type: BW },
  { brand: "Lomography", name: "Lady Grey 400",            iso: "400",     type: BW },
  { brand: "Lomography", name: "Lomochrome Metropolis",    iso: "100–400", type: COLOR },
  { brand: "Lomography", name: "Lomochrome Purple",        iso: "100–400", type: COLOR },
  // Rollei
  { brand: "Rollei", name: "Retro 80S",    iso: "80",  type: BW },
  { brand: "Rollei", name: "Retro 400S",   iso: "400", type: BW },
  { brand: "Rollei", name: "RPX 25",       iso: "25",  type: BW },
  { brand: "Rollei", name: "RPX 100",      iso: "100", type: BW },
  { brand: "Rollei", name: "RPX 400",      iso: "400", type: BW },
  { brand: "Rollei", name: "Superpan 200", iso: "200", type: BW },
  { brand: "Rollei", name: "Infrared 400", iso: "400", type: BW },
  // Foma
  { brand: "Foma", name: "Fomapan 100 Classic",  iso: "100", type: BW },
  { brand: "Foma", name: "Fomapan 200 Creative", iso: "200", type: BW },
  { brand: "Foma", name: "Fomapan 400 Action",   iso: "400", type: BW },
  // Adox
  { brand: "Adox", name: "CHS 100 II",       iso: "100", type: BW },
  { brand: "Adox", name: "Color Mission 200", iso: "200", type: COLOR },
  // Kentmere / Harman
  { brand: "Kentmere", name: "Pan 100",      iso: "100", type: BW },
  { brand: "Kentmere", name: "Pan 400",      iso: "400", type: BW },
  { brand: "Harman",   name: "Phoenix 200",  iso: "200", type: COLOR },
  // AgfaPhoto
  { brand: "AgfaPhoto", name: "Vista Plus 200", iso: "200", type: COLOR },
];
