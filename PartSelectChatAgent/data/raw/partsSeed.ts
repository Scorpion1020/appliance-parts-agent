export type RawPartSeed = {
  partNumber: string;
  manufacturerPartNumber: string;
  name: string;
  description: string;
  applianceType: "refrigerator" | "dishwasher";
  brand: string;
  price: number;
  availability: "In stock" | "Limited stock" | "Out of stock";
  compatibleModels: string[];
  symptoms: string[];
  installationSteps: string[];
  sourceUrl: string;
  sourceType: "product" | "installation" | "troubleshooting" | "compatibility";
};

export const partsSeed: RawPartSeed[] = [
  {
    partNumber: "PS11752778",
    manufacturerPartNumber: "WPW10321304",
    name: "Refrigerator Door Shelf Bin",
    description: "Door-mounted refrigerator storage bin. Verify the full model before ordering; the price shown is for this demonstration only.",
    applianceType: "refrigerator",
    brand: "Whirlpool",
    price: 39.99,
    availability: "In stock",
    compatibleModels: [],
    symptoms: ["broken refrigerator door bin", "cracked shelf bin"],
    installationSteps: [],
    sourceUrl: "https://www.partselect.com/PS11752778-Whirlpool-WPW10321304-Refrigerator-Door-Shelf-Bin.htm",
    sourceType: "product"
  },
  {
    partNumber: "WPW10300024",
    manufacturerPartNumber: "WPW10300024",
    name: "Refrigerator Ice Maker Assembly",
    description: "Automatic ice maker assembly for compatible Whirlpool refrigerators.",
    applianceType: "refrigerator",
    brand: "Whirlpool",
    price: 109.99,
    availability: "Limited stock",
    compatibleModels: ["WRS588FIHZ00", "WRX735SDHZ00", "WRF535SWHZ00"],
    symptoms: ["ice maker not working", "no ice", "ice cubes are small"],
    installationSteps: [
      "Disconnect power and remove the ice bin.",
      "Remove the mounting screws and unplug the ice maker harness.",
      "Transfer any mounting bracket or fill tube components if needed.",
      "Install the new assembly and reconnect the harness.",
      "Restore power and allow a full harvest cycle."
    ],
    sourceUrl: "https://www.partselect.com/PS11752391-Whirlpool-WPW10300024-Ice-Maker.htm",
    sourceType: "product"
  },
  {
    partNumber: "W10408179",
    manufacturerPartNumber: "W10408179",
    name: "Refrigerator Water Inlet Valve",
    description: "Controls water flow to the ice maker and dispenser in compatible refrigerators.",
    applianceType: "refrigerator",
    brand: "Whirlpool",
    price: 64.95,
    availability: "In stock",
    compatibleModels: ["WRS588FIHZ00", "WRF535SWHZ00", "GI6SARXXF04"],
    symptoms: ["ice maker not working", "no water", "slow water flow"],
    installationSteps: [
      "Unplug the refrigerator and shut off the water supply.",
      "Remove the rear access panel.",
      "Disconnect the inlet and outlet water lines from the old valve.",
      "Move the wiring harness and install the replacement valve.",
      "Restore water, check for leaks, and test ice production."
    ],
    sourceUrl: "https://www.partselect.com/Refrigerator-Water-Inlet-Valve-W10408179.htm",
    sourceType: "product"
  },
  {
    partNumber: "WPW10448645",
    manufacturerPartNumber: "WPW10448645",
    name: "Dishwasher Middle Spray Arm",
    description: "Middle spray arm for model-specific dishwasher wash systems. Verify the complete model before ordering.",
    applianceType: "dishwasher",
    brand: "Whirlpool",
    price: 28.5,
    availability: "In stock",
    compatibleModels: [],
    symptoms: ["poor cleaning", "dishes still dirty", "spray arm broken"],
    installationSteps: [],
    sourceUrl: "https://www.partselect.com/PS11754873-Whirlpool-WPW10448645-Middle-Spray-Arm.htm",
    sourceType: "product"
  },
  {
    partNumber: "WPW10195417V",
    manufacturerPartNumber: "WPW10195417V",
    name: "Dishwasher Rack Wheel",
    description: "Replacement wheel that supports smooth movement of the dishwasher rack.",
    applianceType: "dishwasher",
    brand: "Whirlpool",
    price: 12.99,
    availability: "In stock",
    compatibleModels: ["WDT780SAEM1", "WDF520PADM7", "WDT730PAHZ0"],
    symptoms: ["rack not rolling", "rack falls off track", "rack wheel broken"],
    installationSteps: [
      "Pull the rack out until the damaged wheel is accessible.",
      "Release the old wheel from the rack rail.",
      "Snap the replacement wheel into place.",
      "Test the rack movement on both rails.",
      "Reinstall the rack and confirm smooth travel."
    ],
    sourceUrl: "https://www.partselect.com/Dishwasher-Rack-Wheel-WPW10195417V.htm",
    sourceType: "product"
  },
  {
    partNumber: "PS11746337",
    manufacturerPartNumber: "WPW10195416",
    name: "Dishwasher Lower Dishrack Wheel Assembly",
    description: "Lower dishrack wheel assembly with clip for smooth rack travel. Demonstration catalog entry.",
    applianceType: "dishwasher",
    brand: "Whirlpool",
    price: 18.49,
    availability: "In stock",
    compatibleModels: ["WDT780SAEM1", "WDT750SAHZ0", "WDF540PADM3"],
    symptoms: ["rack not rolling", "lower rack stuck", "broken rack wheel"],
    installationSteps: [
      "Pull the lower rack out of the dishwasher tub.",
      "Press the locking tab to release the worn wheel assembly.",
      "Snap the replacement assembly onto the rack wire until it clicks.",
      "Slide the rack back onto the track and verify smooth alignment."
    ],
    sourceUrl: "https://www.partselect.com/PS11746337-Whirlpool-WPW10195416-Lower-Dishrack-Wheel.htm",
    sourceType: "product"
  },
  {
    partNumber: "PS11755833",
    manufacturerPartNumber: "W10542314",
    name: "Dishwasher Door Gasket Seal",
    description: "Perimeter tub door gasket that helps prevent water leaks around the dishwasher door. Demonstration catalog entry.",
    applianceType: "dishwasher",
    brand: "Whirlpool",
    price: 34.95,
    availability: "In stock",
    compatibleModels: ["WDT780SAEM1", "WDF520PADM7", "WDT720PADM2"],
    symptoms: ["dishwasher leaking", "water dripping from door", "worn door seal"],
    installationSteps: [
      "Turn off power to the dishwasher and open the door fully.",
      "Pull the old gasket out of the tub channel.",
      "Clean any soap residue from the channel.",
      "Press the new gasket evenly into the channel starting from the top center.",
      "Close the door for several hours to let the seal seat properly."
    ],
    sourceUrl: "https://www.partselect.com/PS11755833-Whirlpool-W10542314-Dishwasher-Door-Gasket.htm",
    sourceType: "product"
  },
  {
    partNumber: "PS11753379",
    manufacturerPartNumber: "WPW10348269",
    name: "Dishwasher Drain Pump",
    description: "Electric drain pump that removes wastewater from the dishwasher sump during the drain cycle. Demonstration catalog entry.",
    applianceType: "dishwasher",
    brand: "Whirlpool",
    price: 54.99,
    availability: "In stock",
    compatibleModels: ["WDT780SAEM1", "WDT750SAHZ0", "WDF520PADM7"],
    symptoms: ["dishwasher not draining", "standing water in tub", "humming during drain"],
    installationSteps: [
      "Disconnect power and shut off the water supply.",
      "Remove the lower access panel and place a towel under the sump.",
      "Unplug the wire harness and twist the old drain pump counterclockwise to remove.",
      "Install the replacement pump, lock it into place, and reconnect the harness.",
      "Restore power and run a short rinse/drain test to check for leaks."
    ],
    sourceUrl: "https://www.partselect.com/PS11753379-Whirlpool-WPW10348269-Drain-Pump.htm",
    sourceType: "product"
  },
  {
    partNumber: "PS11757023",
    manufacturerPartNumber: "W10518394",
    name: "Dishwasher Heating Element",
    description: "Tub heating element that heats wash water and assists with dish drying. Demonstration catalog entry.",
    applianceType: "dishwasher",
    brand: "Whirlpool",
    price: 49.5,
    availability: "In stock",
    compatibleModels: ["WDT780SAEM1", "WDF540PADM3", "ADB1500ADB1"],
    symptoms: ["dishes not drying", "water not heating", "cold wash cycle"],
    installationSteps: [
      "Disconnect electrical power and remove the lower rack.",
      "Access the underside of the tub and disconnect the two heating element terminals.",
      "Unscrew the mounting nuts and lift the old element out from inside the tub.",
      "Insert the new heating element, secure the mounting nuts, and reconnect terminals."
    ],
    sourceUrl: "https://www.partselect.com/PS11757023-Whirlpool-W10518394-Heating-Element.htm",
    sourceType: "product"
  },
  {
    partNumber: "PS11748801",
    manufacturerPartNumber: "WPW10195840",
    name: "Dishwasher Upper Rack Adjuster Positioner",
    description: "Upper rack adjuster mechanism that lets the top dishrack raise or lower smoothly. Demonstration catalog entry.",
    applianceType: "dishwasher",
    brand: "Whirlpool",
    price: 22.75,
    availability: "In stock",
    compatibleModels: ["WDT780SAEM1", "WDT750SAHZ0", "WDT730PAHZ0"],
    symptoms: ["upper rack sagging", "rack adjuster broken", "top rack will not stay level"],
    installationSteps: [],
    sourceUrl: "https://www.partselect.com/PS11748801-Whirlpool-WPW10195840-Rack-Adjuster.htm",
    sourceType: "product"
  },
  {
    partNumber: "PS11756150",
    manufacturerPartNumber: "W10705575",
    name: "Dishwasher Sump Filter Cup",
    description: "Removable cylindrical mesh filter that traps food particles in the dishwasher sump. Demonstration catalog entry.",
    applianceType: "dishwasher",
    brand: "Whirlpool",
    price: 26.4,
    availability: "In stock",
    compatibleModels: ["WDT780SAEM1", "WDF520PADM7", "ADB1500ADB1"],
    symptoms: ["poor cleaning", "gritty residue on dishes", "dishwasher odor", "torn filter mesh"],
    installationSteps: [],
    sourceUrl: "https://www.partselect.com/PS11756150-Whirlpool-W10705575-Filter-Cup.htm",
    sourceType: "product"
  },
  {
    partNumber: "PS12741258",
    manufacturerPartNumber: "WD21X10490",
    name: "GE Dishwasher Door Latch Switch",
    description: "Door latch assembly with interlock switch that detects when the GE dishwasher door is closed. Demonstration catalog entry.",
    applianceType: "dishwasher",
    brand: "GE",
    price: 31.8,
    availability: "In stock",
    compatibleModels: ["GDT655SSJ0SS", "GDF520PGJ2WW", "PDT715SYN0FS"],
    symptoms: ["dishwasher will not start", "door will not latch", "lights blinking no start"],
    installationSteps: [],
    sourceUrl: "https://www.partselect.com/PS12741258-GE-WD21X10490-Door-Latch.htm",
    sourceType: "product"
  },
  {
    partNumber: "PS11726733",
    manufacturerPartNumber: "WD19X25187",
    name: "GE Dishwasher Drain Pump Kit",
    description: "Replacement drain pump kit for compatible GE dishwashers experiencing slow or failed drainage. Demonstration catalog entry.",
    applianceType: "dishwasher",
    brand: "GE",
    price: 62.0,
    availability: "Limited stock",
    compatibleModels: ["GDT655SSJ0SS", "GDF520PGJ2WW"],
    symptoms: ["dishwasher not draining", "standing water", "drain error"],
    installationSteps: [],
    sourceUrl: "https://www.partselect.com/PS11726733-GE-WD19X25187-Drain-Pump-Kit.htm",
    sourceType: "product"
  },
  {
    partNumber: "PS11752927",
    manufacturerPartNumber: "WPW10312695",
    name: "Refrigerator Fresh Food Door Gasket",
    description: "Magnetic perimeter door seal for compatible refrigerators to maintain airtight cooling. Demonstration catalog entry.",
    applianceType: "refrigerator",
    brand: "Whirlpool",
    price: 89.5,
    availability: "In stock",
    compatibleModels: ["WSF26C3EXF01", "WRS588FIHZ00", "WRF535SWHZ00"],
    symptoms: ["refrigerator door not closing", "warm fridge", "condensation around door", "torn door gasket"],
    installationSteps: [],
    sourceUrl: "https://www.partselect.com/PS11752927-Whirlpool-WPW10312695-Door-Gasket.htm",
    sourceType: "product"
  },
  {
    partNumber: "PS11750057",
    manufacturerPartNumber: "WP2315549",
    name: "Refrigerator Evaporator Fan Motor",
    description: "Circulates cold air over the evaporator coils and throughout the refrigerator and freezer compartments. Demonstration catalog entry.",
    applianceType: "refrigerator",
    brand: "Whirlpool",
    price: 58.25,
    availability: "In stock",
    compatibleModels: ["WRS588FIHZ00", "WRF535SWHZ00", "WSF26C3EXF01"],
    symptoms: ["refrigerator warm", "freezer cold but fridge warm", "loud squealing noise"],
    installationSteps: [],
    sourceUrl: "https://www.partselect.com/PS11750057-Whirlpool-WP2315549-Evaporator-Fan-Motor.htm",
    sourceType: "product"
  },
  {
    partNumber: "PS11740740",
    manufacturerPartNumber: "WPW10225581",
    name: "Refrigerator Defrost Bimetal Thermostat",
    description: "Clips onto the evaporator tubing to regulate the defrost heater and prevent frost buildup. Demonstration catalog entry.",
    applianceType: "refrigerator",
    brand: "Whirlpool",
    price: 27.99,
    availability: "In stock",
    compatibleModels: ["WRS588FIHZ00", "WRX735SDHZ00", "WSF26C3EXF01"],
    symptoms: ["frost buildup in freezer", "evaporator coils iced over", "refrigerator not cooling"],
    installationSteps: [],
    sourceUrl: "https://www.partselect.com/PS11740740-Whirlpool-WPW10225581-Defrost-Thermostat.htm",
    sourceType: "product"
  },
  {
    partNumber: "PS11743427",
    manufacturerPartNumber: "EDR1RXD1",
    name: "Refrigerator Replacement Water Filter",
    description: "Push-in water filtration cartridge for compatible Whirlpool refrigerator water dispensers and ice makers. Demonstration catalog entry.",
    applianceType: "refrigerator",
    brand: "Whirlpool",
    price: 49.99,
    availability: "In stock",
    compatibleModels: ["WRS588FIHZ00", "WRX735SDHZ00", "WRF535SWHZ00"],
    symptoms: ["slow water dispenser", "bad tasting ice", "water filter indicator on"],
    installationSteps: [],
    sourceUrl: "https://www.partselect.com/PS11743427-Whirlpool-EDR1RXD1-Water-Filter.htm",
    sourceType: "product"
  },
  {
    partNumber: "PS12582112",
    manufacturerPartNumber: "WR60X26866",
    name: "GE Refrigerator Evaporator Fan Motor",
    description: "Fresh food evaporator fan motor for compatible GE French-door and bottom-freezer refrigerators. Demonstration catalog entry.",
    applianceType: "refrigerator",
    brand: "GE",
    price: 74.9,
    availability: "In stock",
    compatibleModels: ["GFE28GYNFS", "PFE28KYNFS", "GNE27JYMFS"],
    symptoms: ["GE refrigerator warm", "not cooling enough", "unusual fan noise"],
    installationSteps: [],
    sourceUrl: "https://www.partselect.com/PS12582112-GE-WR60X26866-Evaporator-Fan-Motor.htm",
    sourceType: "product"
  },
  {
    partNumber: "PS11766956",
    manufacturerPartNumber: "WR55X10942P",
    name: "GE Refrigerator Main Control Board",
    description: "Main electronic control board managing compressor, defrost, and fan operation in compatible GE refrigerators. Demonstration catalog entry.",
    applianceType: "refrigerator",
    brand: "GE",
    price: 168.0,
    availability: "Limited stock",
    compatibleModels: ["GFE28GYNFS", "GSS25GSHSS"],
    symptoms: ["refrigerator not cooling", "clicking noise", "compressor not starting"],
    installationSteps: [],
    sourceUrl: "https://www.partselect.com/PS11766956-GE-WR55X10942P-Main-Control-Board.htm",
    sourceType: "product"
  },
  {
    partNumber: "PS12722959",
    manufacturerPartNumber: "WR14X27235",
    name: "GE Refrigerator Freezer Door Gasket",
    description: "Replacement freezer door seal gasket for compatible GE refrigerators to stop air leaks and frost. Demonstration catalog entry.",
    applianceType: "refrigerator",
    brand: "GE",
    price: 84.2,
    availability: "In stock",
    compatibleModels: ["GFE28GYNFS", "PFE28KYNFS"],
    symptoms: ["freezer door not closing", "frost near door", "air leak"],
    installationSteps: [],
    sourceUrl: "https://www.partselect.com/PS12722959-GE-WR14X27235-Freezer-Door-Gasket.htm",
    sourceType: "product"
  }
];
