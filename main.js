(() => {
      "use strict";

      const variableMeta = {
        courage: { label: "Courage", color: "#ff6b2b", dim: "#8b3a0f", icon: "C" },
        trust: { label: "Trust", color: "#2eb8a0", dim: "#155c50", icon: "T" },
        karma: { label: "Karma", color: "#c9a84c", dim: "#6b5520", icon: "K" },
        wisdom: { label: "Wisdom", color: "#7b4fc9", dim: "#3a2060", icon: "W" },
        chaos: { label: "Chaos", color: "#c0392b", dim: "#6b1a14", icon: "X" },
        health: { label: "Health", color: "#e05858", dim: "#702222", icon: "H" },
        wealth: { label: "Wealth", color: "#d4a843", dim: "#6b5520", icon: "$" }
      };

      const factorDefs = [
        { id: "CombatFactor", label: "Combat", color: "#ff6b2b", variables: ["courage", "health", "chaos"], weights: { courage: 0.72, health: 0.48, chaos: 0.68 }, charge: 0.08 },
        { id: "DialogueFactor", label: "Dialogue", color: "#2eb8a0", variables: ["trust", "karma", "wisdom"], weights: { trust: 0.68, karma: 0.55, wisdom: 0.42 }, charge: 0.08 },
        { id: "ExplorationFactor", label: "Explore", color: "#7b4fc9", variables: ["wisdom", "courage", "wealth"], weights: { wisdom: 0.72, courage: 0.38, wealth: 0.32 }, charge: 0.08 },
        { id: "MoralFactor", label: "Moral", color: "#c9a84c", variables: ["karma", "trust", "chaos"], weights: { karma: 0.78, trust: 0.36, chaos: -0.58 }, charge: 0.08 },
        { id: "ResourceFactor", label: "Resource", color: "#d4a843", variables: ["wealth", "health", "chaos"], weights: { wealth: 0.68, health: 0.34, chaos: 0.36 }, charge: 0.08 }
      ];

      const factorByScene = {
        combat: "CombatFactor",
        dialogue: "DialogueFactor",
        exploration: "ExplorationFactor",
        moral: "MoralFactor",
        resource: "ResourceFactor"
      };

      const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
      const romanAct = (turn) => turn <= 4 ? "I" : turn <= 9 ? "II" : "III";
      const signed = (value) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
      const normalize = (arr) => {
        const sum = arr[0] + arr[1];
        if (!Number.isFinite(sum) || sum <= 0) return [0.5, 0.5];
        return [arr[0] / sum, arr[1] / sum];
      };

      class FactorGraph {
        constructor() {
          this.variables = {};
          this.factors = factorDefs.map((factor) => ({ ...factor, weights: { ...factor.weights } }));
          Object.keys(variableMeta).forEach((id) => {
            this.variables[id] = { id, prior: 0.5, belief: 0.5 };
          });
          this.variableToFactor = new Map();
          this.factorToVariable = new Map();
          this.factors.forEach((factor) => {
            factor.variables.forEach((variable) => {
              this.variableToFactor.set(`${variable}->${factor.id}`, [0.5, 0.5]);
              this.factorToVariable.set(`${factor.id}->${variable}`, [0.5, 0.5]);
            });
          });
          this.runBeliefPropagation(7);
        }

        factorFor(id) {
          return this.factors.find((factor) => factor.id === id);
        }

        connectedFactors(variable) {
          return this.factors.filter((factor) => factor.variables.includes(variable));
        }

        observe(deltas, sourceFactorId) {
          Object.entries(deltas || {}).forEach(([variable, delta]) => {
            if (this.variables[variable]) {
              this.variables[variable].prior = clamp(this.variables[variable].prior + delta);
            }
          });
          const factor = this.factorFor(sourceFactorId);
          if (factor) {
            const magnitude = Object.values(deltas || {}).reduce((sum, value) => sum + Math.abs(value), 0);
            factor.charge = clamp(factor.charge + magnitude * 0.85, 0.05, 1);
            Object.entries(deltas || {}).forEach(([variable, delta]) => {
              if (factor.weights[variable] !== undefined) {
                factor.weights[variable] = clamp(factor.weights[variable] + delta * 0.7, -1, 1);
              }
            });
          }
          this.factors.forEach((candidate) => {
            if (candidate.id !== sourceFactorId) candidate.charge = clamp(candidate.charge * 0.9, 0.05, 1);
          });
          this.runBeliefPropagation(8);
        }

        runBeliefPropagation(iterations = 6) {
          for (let i = 0; i < iterations; i += 1) {
            const nextVF = new Map(this.variableToFactor);
            const nextFV = new Map(this.factorToVariable);

            this.factors.forEach((factor) => {
              factor.variables.forEach((variable) => {
                const prior = this.variables[variable].prior;
                const product = [1 - prior, prior];
                this.connectedFactors(variable).forEach((otherFactor) => {
                  if (otherFactor.id === factor.id) return;
                  const incoming = this.factorToVariable.get(`${otherFactor.id}->${variable}`) || [0.5, 0.5];
                  product[0] *= incoming[0];
                  product[1] *= incoming[1];
                });
                nextVF.set(`${variable}->${factor.id}`, normalize(product));
              });
            });

            this.factors.forEach((factor) => {
              factor.variables.forEach((target) => {
                const result = [0, 0];
                [0, 1].forEach((targetState) => {
                  const assignment = { [target]: targetState };
                  result[targetState] = this.sumFactorAssignments(factor, target, assignment, 0);
                });
                nextFV.set(`${factor.id}->${target}`, normalize(result));
              });
            });

            this.variableToFactor = nextVF;
            this.factorToVariable = nextFV;
          }

          Object.keys(this.variables).forEach((variable) => {
            const prior = this.variables[variable].prior;
            const product = [1 - prior, prior];
            this.connectedFactors(variable).forEach((factor) => {
              const incoming = this.factorToVariable.get(`${factor.id}->${variable}`) || [0.5, 0.5];
              product[0] *= incoming[0];
              product[1] *= incoming[1];
            });
            this.variables[variable].belief = normalize(product)[1];
          });
        }

        sumFactorAssignments(factor, target, assignment, index) {
          const vars = factor.variables;
          while (index < vars.length && vars[index] === target) index += 1;
          if (index >= vars.length) {
            const messages = vars.reduce((product, variable) => {
              if (variable === target) return product;
              const incoming = this.variableToFactor.get(`${variable}->${factor.id}`) || [0.5, 0.5];
              return product * incoming[assignment[variable]];
            }, 1);
            return this.factorPotential(factor, assignment) * messages;
          }
          const variable = vars[index];
          assignment[variable] = 0;
          const low = this.sumFactorAssignments(factor, target, assignment, index + 1);
          assignment[variable] = 1;
          const high = this.sumFactorAssignments(factor, target, assignment, index + 1);
          delete assignment[variable];
          return low + high;
        }

        factorPotential(factor, assignment) {
          let score = factor.charge;
          factor.variables.forEach((variable) => {
            const state = assignment[variable] ? 1 : -1;
            score += (factor.weights[variable] || 0) * state;
          });
          if (factor.id === "MoralFactor") {
            score += assignment.chaos ? -0.26 : 0.18;
          }
          if (factor.id === "CombatFactor") {
            score += assignment.courage && !assignment.health ? -0.22 : 0;
          }
          return Math.exp(score * 0.62);
        }

        beliefs() {
          const out = {};
          Object.keys(this.variables).forEach((id) => {
            out[id] = this.variables[id].belief;
          });
          return out;
        }

        priors() {
          const out = {};
          Object.keys(this.variables).forEach((id) => {
            out[id] = this.variables[id].prior;
          });
          return out;
        }

        edges() {
          return this.factors.flatMap((factor) => factor.variables.map((variable) => ({
            factor: factor.id,
            variable,
            weight: Math.abs(factor.weights[variable] || 0),
            charge: factor.charge,
            color: variableMeta[variable].color
          })));
        }
      }

      class GameState {
        constructor(graph) {
          this.graph = graph;
          this.turn = 1;
          this.sceneTag = "dialogue";
          this.worldEvent = "The Crossroads Bell Rings";
          this.history = [];
          this.lastDelta = {};
          this.inventory = ["Wayfarer Sigil", "Ash-stained Map"];
          this.factions = { Freeholds: 50, Crown: 50, "Ashen Court": 50 };
          this.ended = false;
        }

        act() {
          return romanAct(this.turn);
        }

        location() {
          if (this.turn <= 4) return "Crossroads Village";
          if (this.turn <= 6) return "Dark Forest";
          if (this.turn <= 9) return "Ancient Ruins";
          if (this.turn <= 11) return "The Citadel";
          return "The Final Chamber";
        }

        applyChoice(choice) {
          const factorId = choice.factor || factorByScene[choice.sceneTag] || factorByScene[this.sceneTag] || "DialogueFactor";
          this.lastDelta = { ...(choice.factorHints || {}) };
          this.graph.observe(this.lastDelta, factorId);
          this.sceneTag = choice.nextTag || choice.sceneTag || this.sceneTag;
          this.history.unshift({
            turn: this.turn,
            text: choice.text,
            factor: factorId,
            deltas: { ...this.lastDelta }
          });
          this.history = this.history.slice(0, 6);
          this.updateFactions(choice);
          this.updateInventory(choice);
          this.turn += 1;
          if (this.turn > 12) this.ended = true;
        }

        updateFactions(choice) {
          const hints = choice.factorHints || {};
          this.factions.Freeholds = Math.round(clamp((this.factions.Freeholds + (hints.trust || 0) * 80 + (hints.karma || 0) * 45) / 100, 0, 1) * 100);
          this.factions.Crown = Math.round(clamp((this.factions.Crown + (hints.wealth || 0) * 70 - (hints.chaos || 0) * 35) / 100, 0, 1) * 100);
          this.factions["Ashen Court"] = Math.round(clamp((this.factions["Ashen Court"] + (hints.chaos || 0) * 90 - (hints.karma || 0) * 35) / 100, 0, 1) * 100);
        }

        updateInventory(choice) {
          const hints = choice.factorHints || {};
          const candidates = [
            [hints.wisdom > 0.09, "Rune Shard"],
            [hints.trust > 0.09, "Village Oath"],
            [hints.courage > 0.1, "Iron Vow"],
            [hints.wealth > 0.1, "Gilded Token"],
            [hints.chaos > 0.12, "Ash Mark"],
            [hints.karma > 0.11, "Mercy Braid"],
            [hints.health < -0.1, "Bloodied Cloak"]
          ];
          const found = candidates.find(([condition, item]) => condition && !this.inventory.includes(item));
          if (found) this.inventory.push(found[1]);
        }

        ending() {
          const b = this.graph.beliefs();
          if (b.karma > 0.7 && b.trust > 0.65) return {
            key: "hero",
            title: "The Hero's Ascension",
            color: "#c9a84c",
            copy: "The realm remembers your mercy as law. Villages once divided raise the same lanterns, and the roads that feared every hoofbeat now carry songs. You do not claim a throne so much as become the oath that holds it together."
          };
          if (b.karma < 0.3 && b.chaos > 0.7) return {
            key: "dark",
            title: "The Dark Sovereign",
            color: "#c0392b",
            copy: "The citadel kneels beneath a crown of cinders. You mastered the fracture by feeding it, and every faction learns that peace can be forged from fear. The map burns clean where your name is written."
          };
          if (b.wisdom > 0.8 && b.chaos < 0.4) return {
            key: "wise",
            title: "The Wise Exile",
            color: "#7b4fc9",
            copy: "You refuse the court, the crown, and the easy myth of victory. With the final rune translated, you seal the old wound and walk beyond the border stones, carrying the one truth too dangerous for kingdoms."
          };
          if (b.health < 0.2 && b.courage > 0.7) return {
            key: "fallen",
            title: "The Fallen Champion",
            color: "#8b3a0f",
            copy: "Your last stand breaks the siege line and gives the realm one more dawn. The bards argue over your choices, but not over your courage. On the road where you fell, no shadow crosses without trembling."
          };
          const values = Object.values(b);
          const balanced = values.every((value) => value >= 0.4 && value <= 0.6);
          if (balanced) return {
            key: "gray",
            title: "The Gray Wanderer",
            color: "#2eb8a0",
            copy: "You leave no empire behind, only choices held in careful balance. Some call you coward, some call you saint, but the roads stay open, and the realm learns to survive without a single hand around its throat."
          };
          return {
            key: "wild",
            title: "The Ember Cartographer",
            color: "#ff6b2b",
            copy: "The factor web refuses prophecy. Trust, ruin, wisdom, coin, and blood all flare in competing constellations. You become the mapmaker of an unfinished realm, charting roads no oracle had the nerve to draw."
          };
        }
      }

      class NarrativeEngine {
        initialScene(state) {
          return {
            sceneTag: "dialogue",
            worldEvent: "The Crossroads Bell Rings",
            sceneName: state.location(),
            speaker: "Aldric",
            speakerLine: "The old road has begun listening again. Choose carefully, wanderer.",
            narrative: "At the center of Crossroads Village, a bell with no rope begins to ring beneath the moon. The sound moves through the market stalls, under shuttered doors, and into the burned seams of your ash-stained map. Aldric, the village elder, waits beside the dry well with a staff of blackthorn and a face carved by too many winters. Around him, merchants hide their ledgers, militia hands drift toward spear shafts, and a hooded rogue watches from the chapel eaves. Every rumor in the Shattered Realm has gathered here: a citadel waking in the north, ruins breathing under the forest, and a crown that may no longer belong to the living. Your first answer will not branch the story like a road. It will bend the whole web.",
            choices: [
              { text: "Ask Aldric for the truth behind the silent bell.", factorHints: { wisdom: 0.12, trust: 0.08, chaos: -0.04 }, sceneTag: "dialogue", nextTag: "exploration", outcome: "Recover hidden knowledge", factor: "DialogueFactor" },
              { text: "Follow the hooded rogue before the militia notices.", factorHints: { courage: 0.09, wisdom: 0.05, trust: -0.05, chaos: 0.08 }, sceneTag: "exploration", nextTag: "moral", outcome: "Enter the alleys unseen", factor: "ExplorationFactor" },
              { text: "Help the merchant barricade the square and demand payment.", factorHints: { wealth: 0.13, trust: 0.04, karma: -0.05, chaos: 0.03 }, sceneTag: "resource", nextTag: "resource", outcome: "Secure coin and supplies", factor: "ResourceFactor" }
            ]
          };
        }

        async generate(state, selectedChoice) {
          return this.generateLocal(state, selectedChoice);
        }

        generateLocal(state) {
          const beliefs = state.graph.beliefs();
          const top = Object.entries(beliefs).sort((a, b) => b[1] - a[1])[0][0];
          const low = Object.entries(beliefs).sort((a, b) => a[1] - b[1])[0][0];
          const tag = this.pickSceneTag(state, top, low);
          const location = state.location();
          const speaker = this.pickSpeaker(tag, beliefs, state.turn);
          const event = this.eventTitle(tag, location, beliefs);
          const mood = beliefs.chaos > 0.66 ? "fevered" : beliefs.karma > 0.66 ? "lantern-lit" : beliefs.wisdom > 0.68 ? "rune-haunted" : "ember-dim";
          const last = state.history[0]?.text || "answer the bell";
          const pressure = this.pressureLine(top, low, beliefs);
          const narrative = `The ${mood} road carries the consequence of your choice to ${last.toLowerCase()}. In ${location}, the stones seem to rearrange themselves whenever the factor web settles, as if the realm is learning your shape. ${speaker} steps into the firelight while the ash map brightens along its torn edges. The strongest belief now gathers around ${variableMeta[top].label.toLowerCase()}, while ${variableMeta[low].label.toLowerCase()} flickers at the edge of collapse. ${pressure} Beyond the nearest rooftops, scouts report movement: banners without wind, a courier with no shadow, and a gate opening where no wall should stand. The graph does not show destiny. It shows pressure. Every node hums with borrowed probability, waiting for your next answer to decide which rumor becomes history.`;
          return {
            sceneTag: tag,
            worldEvent: event,
            sceneName: location,
            speaker,
            speakerLine: this.speakerLine(speaker, tag, top, low),
            narrative,
            choices: this.choicesFor(tag, beliefs, state.turn)
          };
        }

        pickSceneTag(state, top, low) {
          const cycle = ["dialogue", "exploration", "moral", "resource", "combat"];
          if (state.turn >= 10) return state.graph.beliefs().chaos > 0.58 ? "combat" : "moral";
          if (top === "chaos" || low === "health") return "combat";
          if (top === "wealth") return "resource";
          if (top === "wisdom") return "exploration";
          if (top === "karma") return "moral";
          return cycle[state.turn % cycle.length];
        }

        pickSpeaker(tag, beliefs, turn) {
          if (turn >= 10) return beliefs.chaos > 0.55 ? "Commander Vex" : "Elowen";
          const byTag = {
            combat: "Commander Vex",
            dialogue: "Aldric",
            exploration: beliefs.trust < 0.45 ? "Kira" : "Aldric",
            moral: beliefs.karma > 0.55 ? "Elowen" : "Kira",
            resource: "Seraph"
          };
          return byTag[tag] || "Aldric";
        }

        pressureLine(top, low, beliefs) {
          if (beliefs.chaos > 0.72) return "Doors slam open before hands touch them, and even honest voices arrive with a crackle of red static.";
          if (beliefs.trust > 0.68) return "Strangers make room at the tables, passing news in low voices because your name has begun to mean shelter.";
          if (beliefs.wisdom > 0.72) return "Old symbols stop behaving like carvings and start behaving like instructions meant only for you.";
          if (beliefs.health < 0.32) return "Your wounds tug at every breath, turning each brave thought into a debt the body may soon collect.";
          return `The rise of ${variableMeta[top].label.toLowerCase()} makes the air sharper, while the fall of ${variableMeta[low].label.toLowerCase()} leaves a hollow place in the song.`;
        }

        eventTitle(tag, location, beliefs) {
          const prefix = {
            combat: "Iron Shadows Gather",
            dialogue: "A Secret Changes Hands",
            exploration: "The Map Bleeds Gold",
            moral: "The Mercy Scale Tilts",
            resource: "A Bargain Opens"
          }[tag];
          const suffix = beliefs.chaos > 0.65 ? "Under a Red Moon" : `at ${location}`;
          return `${prefix} ${suffix}`;
        }

        speakerLine(speaker, tag, top, low) {
          const lines = {
            Aldric: `Your ${variableMeta[top].label.toLowerCase()} is loud tonight, but listen for what your ${variableMeta[low].label.toLowerCase()} refuses to say.`,
            Seraph: "Friend, every curse has a market price. The trick is knowing who pays it.",
            Kira: "Maps lie less than people. People bleed more usefully.",
            "Commander Vex": "Choose with both hands. I respect only the wound that admits it wanted to be made.",
            Elowen: "A realm can be healed, but not by pretending the knife was never there."
          };
          return lines[speaker] || lines.Aldric;
        }

        choicesFor(tag, beliefs, turn) {
          const decks = {
            combat: [
              { text: "Meet the armored patrol in open challenge.", factorHints: { courage: 0.15, health: -0.1, chaos: 0.07 }, outcome: "Force a decisive clash", sceneTag: "combat", nextTag: "moral", factor: "CombatFactor" },
              { text: "Break their formation with a risky feint through the smoke.", factorHints: { courage: 0.09, wisdom: 0.07, health: -0.05, chaos: 0.05 }, outcome: "Win through motion", sceneTag: "combat", nextTag: "exploration", factor: "CombatFactor" },
              { text: "Lower your weapon and expose the commander's lie.", factorHints: { trust: 0.11, karma: 0.08, courage: 0.04, chaos: -0.08 }, outcome: "Turn violence into testimony", sceneTag: "dialogue", nextTag: "dialogue", factor: "DialogueFactor" }
            ],
            dialogue: [
              { text: "Tell the full truth, including the parts that weaken you.", factorHints: { trust: 0.14, karma: 0.09, chaos: -0.05 }, outcome: "Earn dangerous trust", sceneTag: "dialogue", nextTag: "moral", factor: "DialogueFactor" },
              { text: "Ask for the hidden name behind the latest omen.", factorHints: { wisdom: 0.13, trust: 0.04, wealth: -0.03 }, outcome: "Open a forbidden lead", sceneTag: "exploration", nextTag: "exploration", factor: "DialogueFactor" },
              { text: "Trade a half-truth for immediate safe passage.", factorHints: { wealth: 0.08, trust: -0.06, karma: -0.04, chaos: 0.06 }, outcome: "Leave before judgment settles", sceneTag: "resource", nextTag: "resource", factor: "ResourceFactor" }
            ],
            exploration: [
              { text: "Trace the glowing route through the ruin's lower arch.", factorHints: { wisdom: 0.15, courage: 0.05, chaos: 0.03 }, outcome: "Study the ancient machinery", sceneTag: "exploration", nextTag: "dialogue", factor: "ExplorationFactor" },
              { text: "Climb the broken watchtower for a wider view.", factorHints: { courage: 0.1, health: -0.04, wisdom: 0.06 }, outcome: "Find the battlefield pattern", sceneTag: "exploration", nextTag: "combat", factor: "ExplorationFactor" },
              { text: "Share your map markings with the refugees.", factorHints: { trust: 0.1, karma: 0.08, wealth: -0.04, chaos: -0.04 }, outcome: "Create a safer route", sceneTag: "moral", nextTag: "moral", factor: "MoralFactor" }
            ],
            moral: [
              { text: "Spare the informant and bind them with an oath.", factorHints: { karma: 0.14, trust: 0.08, chaos: -0.05 }, outcome: "Choose mercy with teeth", sceneTag: "moral", nextTag: "dialogue", factor: "MoralFactor" },
              { text: "Hand the guilty noble to the crowd's judgment.", factorHints: { trust: 0.06, karma: -0.06, chaos: 0.13, courage: 0.05 }, outcome: "Let public fury speak", sceneTag: "moral", nextTag: "combat", factor: "MoralFactor" },
              { text: "Hide the evidence until you can read every side.", factorHints: { wisdom: 0.12, trust: -0.04, chaos: 0.03 }, outcome: "Delay justice for clarity", sceneTag: "exploration", nextTag: "exploration", factor: "ExplorationFactor" }
            ],
            resource: [
              { text: "Spend coin to arm the village watch.", factorHints: { wealth: -0.1, trust: 0.12, health: 0.06, chaos: -0.05 }, outcome: "Invest in survival", sceneTag: "resource", nextTag: "dialogue", factor: "ResourceFactor" },
              { text: "Buy the black-market relic before the Crown arrives.", factorHints: { wealth: -0.08, wisdom: 0.09, chaos: 0.07 }, outcome: "Secure forbidden leverage", sceneTag: "resource", nextTag: "exploration", factor: "ResourceFactor" },
              { text: "Hoard supplies for the road ahead.", factorHints: { wealth: 0.1, health: 0.05, trust: -0.08, karma: -0.04 }, outcome: "Survive at a social cost", sceneTag: "resource", nextTag: "combat", factor: "ResourceFactor" }
            ]
          };
          const choices = decks[tag] || decks.dialogue;
          if (turn >= 10) {
            return [
              { text: "Bind every faction into one final oath.", factorHints: { trust: 0.13, karma: 0.11, chaos: -0.08 }, outcome: "Unite the shattered realm", sceneTag: "moral", nextTag: "moral", factor: "MoralFactor" },
              { text: "Claim the citadel's engine and command its fear.", factorHints: { courage: 0.1, chaos: 0.16, karma: -0.12, health: -0.06 }, outcome: "Rule through fire", sceneTag: "combat", nextTag: "combat", factor: "CombatFactor" },
              { text: "Seal the engine and vanish with its final theorem.", factorHints: { wisdom: 0.16, wealth: -0.05, chaos: -0.1, trust: -0.03 }, outcome: "Choose exile over rule", sceneTag: "exploration", nextTag: "exploration", factor: "ExplorationFactor" }
            ];
          }
          return choices.map((choice) => ({ ...choice, factorHints: { ...choice.factorHints } }));
        }
      }

      class GraphRenderer {
        constructor(canvas, graph) {
          this.canvas = canvas;
          this.ctx = canvas.getContext("2d");
          this.graph = graph;
          this.time = 0;
          this.flashUntil = 0;
          this.resizeObserver = new ResizeObserver(() => this.resize());
          this.resizeObserver.observe(canvas.parentElement);
          this.resize();
          requestAnimationFrame((time) => this.loop(time));
        }

        resize() {
          const parent = this.canvas.parentElement;
          const rect = parent.getBoundingClientRect();
          const dpr = window.devicePixelRatio || 1;
          const nextWidth = Math.max(1, Math.floor(rect.width * dpr));
          const nextHeight = Math.max(1, Math.floor(rect.height * dpr));
          if (this.canvas.width !== nextWidth) this.canvas.width = nextWidth;
          if (this.canvas.height !== nextHeight) this.canvas.height = nextHeight;
          this.canvas.style.width = `${rect.width}px`;
          this.canvas.style.height = `${rect.height}px`;
          this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          this.width = rect.width;
          this.height = rect.height;
          this.draw(performance.now());
        }

        trigger() {
          this.flashUntil = performance.now() + 1200;
        }

        loop(time) {
          this.time = time;
          this.draw(time);
          requestAnimationFrame((next) => this.loop(next));
        }

        positions() {
          const factorX = this.width * 0.26;
          const variableX = this.width * 0.74;
          const factorStep = this.height / (this.graph.factors.length + 1);
          const vars = Object.keys(variableMeta);
          const variableStep = this.height / (vars.length + 1);
          const factors = {};
          const variables = {};
          this.graph.factors.forEach((factor, index) => {
            factors[factor.id] = { x: factorX, y: factorStep * (index + 1) };
          });
          vars.forEach((variable, index) => {
            variables[variable] = { x: variableX, y: variableStep * (index + 1) };
          });
          return { factors, variables };
        }

        draw(time = performance.now()) {
          if (!this.ctx || !this.width || !this.height) return;
          const ctx = this.ctx;
          const { factors, variables } = this.positions();
          ctx.clearRect(0, 0, this.width, this.height);
          this.drawGrid(ctx);
          this.drawEdges(ctx, factors, variables, time);
          this.graph.factors.forEach((factor) => this.drawFactor(ctx, factor, factors[factor.id]));
          Object.entries(this.graph.beliefs()).forEach(([variable, value]) => this.drawVariable(ctx, variable, value, variables[variable]));
          const flash = clamp((this.flashUntil - time) / 1200);
          if (flash > 0) {
            const gradient = ctx.createRadialGradient(this.width / 2, this.height / 2, 10, this.width / 2, this.height / 2, Math.max(this.width, this.height) * 0.6);
            gradient.addColorStop(0, `rgba(255, 170, 68, ${0.18 * flash})`);
            gradient.addColorStop(1, "rgba(255, 170, 68, 0)");
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, this.width, this.height);
          }
        }

        drawGrid(ctx) {
          ctx.fillStyle = "#090909";
          ctx.fillRect(0, 0, this.width, this.height);
          ctx.fillStyle = "rgba(201, 168, 76, 0.13)";
          for (let x = 12; x < this.width; x += 22) {
            for (let y = 12; y < this.height; y += 22) {
              ctx.fillRect(x, y, 1, 1);
            }
          }
        }

        drawEdges(ctx, factors, variables, time) {
          this.graph.edges().forEach((edge, index) => {
            const a = factors[edge.factor];
            const b = variables[edge.variable];
            const strength = clamp(edge.weight * 0.72 + edge.charge * 0.42);
            ctx.save();
            ctx.lineWidth = 0.5 + strength * 3.2;
            ctx.strokeStyle = this.hexToRgba(edge.color, 0.18 + strength * 0.62);
            ctx.shadowColor = edge.color;
            ctx.shadowBlur = 4 + strength * 12;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            const cx = (a.x + b.x) / 2;
            ctx.bezierCurveTo(cx, a.y, cx, b.y, b.x, b.y);
            ctx.stroke();
            ctx.restore();

            const active = this.flashUntil > time ? 1 : 0.45;
            const t = ((time * (0.00028 + strength * 0.00032) + index * 0.19) % 1);
            const dot = this.cubicPoint(a, { x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y }, b, t);
            ctx.save();
            ctx.fillStyle = this.hexToRgba(edge.color, 0.45 + active * 0.5);
            ctx.shadowColor = edge.color;
            ctx.shadowBlur = 11;
            ctx.beginPath();
            ctx.arc(dot.x, dot.y, 2.3 + strength * 2.4, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          });
        }

        drawFactor(ctx, factor, pos) {
          const pulse = 1 + Math.sin(this.time * 0.004 + factor.charge * 4) * 0.04;
          ctx.save();
          ctx.translate(pos.x, pos.y);
          ctx.rotate(Math.PI / 4);
          ctx.scale(pulse, pulse);
          ctx.fillStyle = "rgba(52, 46, 38, 0.95)";
          ctx.strokeStyle = factor.color;
          ctx.lineWidth = 1.5;
          ctx.shadowColor = factor.color;
          ctx.shadowBlur = 7 + factor.charge * 16;
          ctx.beginPath();
          ctx.rect(-13, -13, 26, 26);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
          this.label(ctx, factor.label, pos.x, pos.y + 28, "#c4a882", 10);
        }

        drawVariable(ctx, variable, value, pos) {
          const meta = variableMeta[variable];
          const radius = 13 + value * 10;
          const glow = ctx.createRadialGradient(pos.x, pos.y, 1, pos.x, pos.y, radius * 2.2);
          glow.addColorStop(0, this.hexToRgba(meta.color, 0.78));
          glow.addColorStop(0.45, this.hexToRgba(meta.dim, 0.46));
          glow.addColorStop(1, this.hexToRgba(meta.color, 0));
          ctx.save();
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, radius * 2.1, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = this.hexToRgba(meta.dim, 0.88);
          ctx.strokeStyle = meta.color;
          ctx.lineWidth = 2;
          ctx.shadowColor = meta.color;
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = "#f0e8d8";
          ctx.font = "700 11px Courier Prime, monospace";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(value.toFixed(2), pos.x, pos.y);
          ctx.restore();
          this.label(ctx, meta.label, pos.x, pos.y + radius + 14, meta.color, 10);
        }

        label(ctx, text, x, y, color, size) {
          ctx.save();
          ctx.fillStyle = color;
          ctx.font = `${size}px Courier Prime, monospace`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.shadowColor = "rgba(0,0,0,0.9)";
          ctx.shadowBlur = 4;
          ctx.fillText(text, x, y);
          ctx.restore();
        }

        cubicPoint(p0, p1, p2, p3, t) {
          const u = 1 - t;
          return {
            x: u ** 3 * p0.x + 3 * u ** 2 * t * p1.x + 3 * u * t ** 2 * p2.x + t ** 3 * p3.x,
            y: u ** 3 * p0.y + 3 * u ** 2 * t * p1.y + 3 * u * t ** 2 * p2.y + t ** 3 * p3.y
          };
        }

        hexToRgba(hex, alpha) {
          const raw = hex.replace("#", "");
          const value = parseInt(raw, 16);
          const r = (value >> 16) & 255;
          const g = (value >> 8) & 255;
          const b = value & 255;
          return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }
      }

      class ParticleSystem {
        constructor(canvas) {
          this.canvas = canvas;
          this.ctx = canvas.getContext("2d");
          this.particles = [];
          this.resize();
          window.addEventListener("resize", () => this.resize());
          for (let i = 0; i < 78; i += 1) this.particles.push(this.createParticle(true));
          requestAnimationFrame((time) => this.loop(time));
        }

        resize() {
          const dpr = window.devicePixelRatio || 1;
          this.width = window.innerWidth;
          this.height = window.innerHeight;
          this.canvas.width = Math.floor(this.width * dpr);
          this.canvas.height = Math.floor(this.height * dpr);
          this.canvas.style.width = `${this.width}px`;
          this.canvas.style.height = `${this.height}px`;
          this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        createParticle(randomY = false) {
          return {
            x: Math.random() * this.width,
            y: randomY ? Math.random() * this.height : this.height + 10,
            r: 0.8 + Math.random() * 2.4,
            vx: -0.08 + Math.random() * 0.16,
            vy: -0.1 - Math.random() * 0.28,
            life: 0.36 + Math.random() * 0.58,
            hue: Math.random() > 0.78 ? "#ffaa44" : "#8b3a0f"
          };
        }

        loop() {
          this.step();
          this.draw();
          requestAnimationFrame(() => this.loop());
        }

        step(multiplier = 1) {
          this.particles.forEach((particle, index) => {
            particle.x += particle.vx * multiplier;
            particle.y += particle.vy * multiplier;
            particle.life -= 0.0008 * multiplier;
            if (particle.y < -20 || particle.life <= 0 || particle.x < -20 || particle.x > this.width + 20) {
              this.particles[index] = this.createParticle(false);
            }
          });
        }

        draw() {
          const ctx = this.ctx;
          ctx.clearRect(0, 0, this.width, this.height);
          this.particles.forEach((particle) => {
            ctx.save();
            ctx.globalAlpha = clamp(particle.life, 0, 0.75);
            ctx.fillStyle = particle.hue;
            ctx.shadowColor = particle.hue;
            ctx.shadowBlur = 7;
            ctx.beginPath();
            ctx.arc(particle.x, particle.y, particle.r, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          });
        }
      }

      class SoundSystem {
        constructor() {
          this.ctx = null;
          this.muted = false;
        }

        ensure() {
          if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
          if (this.ctx.state === "suspended") this.ctx.resume();
        }

        tone(freq, duration, type = "sine", gainValue = 0.055, start = 0) {
          if (this.muted) return;
          this.ensure();
          const oscillator = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          oscillator.type = type;
          oscillator.frequency.setValueAtTime(freq, this.ctx.currentTime + start);
          gain.gain.setValueAtTime(0.0001, this.ctx.currentTime + start);
          gain.gain.exponentialRampToValueAtTime(gainValue, this.ctx.currentTime + start + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + start + duration);
          oscillator.connect(gain);
          gain.connect(this.ctx.destination);
          oscillator.start(this.ctx.currentTime + start);
          oscillator.stop(this.ctx.currentTime + start + duration + 0.02);
        }

        noise(duration = 0.16, gainValue = 0.035) {
          if (this.muted) return;
          this.ensure();
          const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * duration, this.ctx.sampleRate);
          const data = buffer.getChannelData(0);
          for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
          const source = this.ctx.createBufferSource();
          const filter = this.ctx.createBiquadFilter();
          const gain = this.ctx.createGain();
          filter.type = "bandpass";
          filter.frequency.value = 820;
          gain.gain.value = gainValue;
          source.buffer = buffer;
          source.connect(filter);
          filter.connect(gain);
          gain.connect(this.ctx.destination);
          source.start();
        }

        choice() {
          this.tone(118, 0.18, "triangle", 0.08);
          this.tone(236, 0.24, "sine", 0.038, 0.03);
          this.noise(0.2, 0.027);
        }

        graph() {
          this.tone(440, 0.18, "sine", 0.035);
          this.tone(660, 0.2, "sine", 0.03, 0.06);
          this.tone(880, 0.22, "sine", 0.022, 0.12);
        }

        ending() {
          [196, 247, 294, 392, 494].forEach((freq, index) => this.tone(freq, 2.4, "sine", 0.028, index * 0.1));
        }
      }

      const graph = new FactorGraph();
      const state = new GameState(graph);
      const narrativeEngine = new NarrativeEngine();
      const graphRenderer = new GraphRenderer(document.getElementById("graphCanvas"), graph);
      const particles = new ParticleSystem(document.getElementById("ashCanvas"));
      const sound = new SoundSystem();
      const scene = { current: narrativeEngine.initialScene(state), busy: false, typeTimer: null };

      const els = {
        turnLabel: document.getElementById("turnLabel"),
        actLabel: document.getElementById("actLabel"),
        worldEventChip: document.getElementById("worldEventChip"),
        chapterLabel: document.getElementById("chapterLabel"),
        sceneTagLabel: document.getElementById("sceneTagLabel"),
        sceneStrip: document.getElementById("sceneStrip"),
        sceneName: document.getElementById("sceneName"),
        sceneSignal: document.getElementById("sceneSignal"),
        speakerName: document.getElementById("speakerName"),
        speakerLine: document.getElementById("speakerLine"),
        characterCast: document.getElementById("characterCast"),
        narrativeText: document.getElementById("narrativeText"),
        choiceArea: document.getElementById("choiceArea"),
        statsList: document.getElementById("statsList"),
        inventoryList: document.getElementById("inventoryList"),
        logList: document.getElementById("logList"),
        factionMeta: document.getElementById("factionMeta"),
        burnOverlay: document.getElementById("burnOverlay"),
        endingScreen: document.getElementById("endingScreen"),
        endingTitle: document.getElementById("endingTitle"),
        endingCopy: document.getElementById("endingCopy"),
        endingBars: document.getElementById("endingBars"),
        endingEmblem: document.getElementById("endingEmblem"),
      };

      function renderAll() {
        const active = scene.current;
        state.worldEvent = active.worldEvent;
        state.sceneTag = active.sceneTag;
        els.turnLabel.textContent = `${Math.min(state.turn, 12)}/12`;
        els.actLabel.textContent = state.act();
        els.worldEventChip.textContent = active.worldEvent;
        els.chapterLabel.textContent = active.sceneName || state.location();
        els.sceneTagLabel.textContent = active.sceneTag;
        els.sceneName.textContent = active.sceneName || state.location();
        els.sceneSignal.textContent = `${active.sceneTag} signal`;
        els.speakerName.textContent = active.speaker || "Narrator";
        els.speakerLine.textContent = active.speakerLine || "";
        renderSceneArt(active.sceneTag, active.sceneName || state.location());
        renderCharacters(active.speaker || "Aldric", active.sceneTag);
        typeNarrative(active.narrative);
        renderChoices(active.choices || []);
        renderStats();
        renderInventory();
        renderLog();
        renderFactions();
        graphRenderer.draw();
      }

      function renderSceneArt(tag, location) {
        const palette = {
          "Crossroads Village": ["#07101d", "#201712", "#ffaa44"],
          "Dark Forest": ["#030806", "#10291c", "#2eb8a0"],
          "Ancient Ruins": ["#25080b", "#131010", "#7b4fc9"],
          "The Citadel": ["#350509", "#0a0708", "#c0392b"],
          "The Final Chamber": ["#080012", "#101020", "#7b4fc9"]
        }[location] || ["#07101d", "#201712", "#ffaa44"];
        const symbol = tag === "combat" ? "M 72 110 L 94 54 L 116 110 Z" : tag === "resource" ? "M 70 92 Q 94 58 118 92 Q 94 116 70 92" : "M 76 104 C 80 62 116 62 120 104";
        els.sceneStrip.querySelectorAll("svg").forEach((svg) => svg.remove());
        els.sceneStrip.insertAdjacentHTML("afterbegin", `
          <svg viewBox="0 0 900 260" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="${palette[0]}"/>
                <stop offset="1" stop-color="${palette[1]}"/>
              </linearGradient>
              <filter id="softGlow">
                <feGaussianBlur stdDeviation="4" result="blur"/>
                <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
            </defs>
            <rect width="900" height="260" fill="url(#sky)"/>
            <circle cx="730" cy="58" r="30" fill="${palette[2]}" opacity="0.24" filter="url(#softGlow)"/>
            <path d="M0 118 C120 84 196 132 300 88 C420 36 540 118 650 82 C756 50 822 86 900 52 L900 260 L0 260 Z" fill="#050505" opacity="0.48"/>
            <path d="M0 154 C94 132 146 164 234 135 C322 106 428 152 516 122 C648 76 720 148 900 104 L900 260 L0 260 Z" fill="#10100f" opacity="0.72"/>
            <g opacity="0.9">
              <path d="${symbol}" fill="${palette[2]}" opacity="0.18" filter="url(#softGlow)"/>
              <path d="${symbol}" fill="#0a0908" stroke="${palette[2]}" stroke-width="2" opacity="0.82"/>
            </g>
            <path d="M0 198 C80 188 110 206 176 194 C260 177 316 204 390 188 C470 170 548 200 636 184 C734 166 800 200 900 180 L900 260 L0 260 Z" fill="#080707"/>
            <g opacity="0.72">
              ${Array.from({ length: 28 }).map((_, i) => `<circle cx="${(i * 37 + 19) % 900}" cy="${66 + ((i * 53) % 138)}" r="${1 + (i % 3)}" fill="${palette[2]}" opacity="${0.14 + (i % 5) * 0.07}"/>`).join("")}
            </g>
            <path d="M0 228 L900 206 L900 260 L0 260 Z" fill="#050505" opacity="0.9"/>
          </svg>
        `);
      }

      function renderCharacters(speaker, tag) {
        const support = tag === "resource" ? "Seraph" : tag === "combat" ? "Commander Vex" : tag === "moral" ? "Elowen" : tag === "exploration" ? "Kira" : "Aldric";
        const names = speaker === "The Wanderer" ? [support, "The Wanderer"] : [speaker, "The Wanderer"];
        els.characterCast.innerHTML = names.map((name, index) => characterSvg(name, index > 0 ? "secondary" : "")).join("");
      }

      function characterSvg(name, extraClass = "") {
        const specs = {
          "The Wanderer": { body: "#11100f", accent: "#ff6b2b", soul: graph.beliefs().karma > 0.55 ? "#c9a84c" : "#c0392b", shape: "M72 28 C50 38 42 76 46 142 L34 192 L110 192 L98 142 C104 78 94 38 72 28 Z", detail: "M58 78 C68 88 76 88 86 78 M56 132 L88 132 M65 46 L78 46" },
          Aldric: { body: "#201b31", accent: "#7b4fc9", soul: "#7b4fc9", shape: "M78 30 C56 44 48 76 50 130 L36 192 L114 192 L102 126 C105 76 98 42 78 30 Z", detail: "M65 62 C72 78 82 78 89 62 M76 84 L76 164 M102 74 L118 178" },
          Seraph: { body: "#332305", accent: "#ffaa44", soul: "#ffaa44", shape: "M72 40 C42 48 34 86 44 132 C50 170 92 174 108 134 C122 88 104 48 72 40 Z", detail: "M48 70 L102 70 M56 120 C72 134 88 134 102 120 M42 92 L24 114 M104 92 L128 110" },
          Kira: { body: "#071617", accent: "#2eb8a0", soul: "#2eb8a0", shape: "M70 28 C48 42 43 82 52 122 L38 192 L108 192 L94 124 C104 82 94 42 70 28 Z", detail: "M58 60 L86 60 M84 94 L118 64 M56 126 L88 110" },
          "Commander Vex": { body: "#160506", accent: "#c0392b", soul: "#c0392b", shape: "M72 22 L42 48 L34 96 L44 192 L108 192 L118 96 L102 48 Z", detail: "M52 62 L92 62 M44 92 L100 92 M74 28 L74 184 M102 86 L132 66" },
          Elowen: { body: "#081b14", accent: "#2eb8a0", soul: "#c9a84c", shape: "M72 30 C50 50 42 90 48 132 L30 192 L116 192 L98 132 C104 90 94 50 72 30 Z", detail: "M52 82 C66 98 84 98 98 82 M48 134 C68 126 84 126 108 134 M38 104 L22 84 M106 104 L126 84" }
        };
        const spec = specs[name] || specs.Aldric;
        return `
          <svg class="character-figure ${extraClass}" viewBox="0 0 150 210" role="img" aria-label="${name}">
            <defs>
              <radialGradient id="soul-${name.replace(/\W/g, "")}" cx="50%" cy="46%" r="42%">
                <stop offset="0" stop-color="${spec.soul}" stop-opacity="0.78"/>
                <stop offset="0.42" stop-color="${spec.soul}" stop-opacity="0.22"/>
                <stop offset="1" stop-color="${spec.soul}" stop-opacity="0"/>
              </radialGradient>
              <filter id="characterGlow-${name.replace(/\W/g, "")}">
                <feGaussianBlur stdDeviation="3" result="blur"/>
                <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
            </defs>
            <ellipse cx="74" cy="192" rx="46" ry="9" fill="#000" opacity="0.45"/>
            <circle cx="74" cy="96" r="52" fill="url(#soul-${name.replace(/\W/g, "")})"/>
            <path d="${spec.shape}" fill="${spec.body}" stroke="#050505" stroke-width="4" opacity="0.98"/>
            <path d="${spec.detail}" fill="none" stroke="${spec.accent}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0.82"/>
            <circle cx="65" cy="57" r="3" fill="${spec.accent}" filter="url(#characterGlow-${name.replace(/\W/g, "")})"/>
            <circle cx="83" cy="57" r="3" fill="${spec.accent}" filter="url(#characterGlow-${name.replace(/\W/g, "")})"/>
            <path d="M45 190 C60 200 90 200 108 190" fill="none" stroke="${spec.accent}" stroke-width="2" opacity="0.34"/>
          </svg>
        `;
      }

      function typeNarrative(text) {
        clearInterval(scene.typeTimer);
        els.narrativeText.textContent = "";
        const full = text || "";
        let index = 0;
        scene.typeTimer = setInterval(() => {
          index += Math.max(1, Math.ceil(full.length / 130));
          els.narrativeText.textContent = full.slice(0, index);
          if (index >= full.length) {
            clearInterval(scene.typeTimer);
            els.narrativeText.textContent = full;
          }
        }, 18);
      }

      function renderChoices(choices) {
        els.choiceArea.innerHTML = "";
        choices.forEach((choice, index) => {
          const button = document.createElement("button");
          button.className = "choice-card";
          button.type = "button";
          button.dataset.index = String(index);
          const badges = Object.entries(choice.factorHints || {}).map(([key, value]) => {
            const meta = variableMeta[key];
            return `<span class="factor-badge" style="--badge-color:${meta?.color || "#ffaa44"}">${meta?.icon || key[0].toUpperCase()} ${signed(value)}</span>`;
          }).join("");
          button.innerHTML = `
            <div class="factor-badges">${badges}</div>
            <p class="choice-text">${choice.text}</p>
            <div class="outcome-tag">${choice.outcome || "Unknown consequence"}</div>
          `;
          button.addEventListener("click", (event) => choose(index, event));
          els.choiceArea.appendChild(button);
        });
      }

      function renderStats() {
        const beliefs = graph.beliefs();
        if (!els.statsList.children.length) {
          els.statsList.innerHTML = Object.keys(variableMeta).map((key) => {
            const meta = variableMeta[key];
            return `
              <div class="stat-row" data-stat="${key}" style="--stat-color:${meta.color}">
                <div class="stat-top">
                  <span class="stat-label"><i class="stat-rune"></i>${meta.label}</span>
                  <span class="stat-value">0.50</span>
                </div>
                <div class="stat-track"><div class="stat-fill"></div></div>
                <span class="stat-delta"></span>
              </div>
            `;
          }).join("");
        }
        Object.entries(beliefs).forEach(([key, value]) => {
          const row = els.statsList.querySelector(`[data-stat="${key}"]`);
          if (!row) return;
          row.querySelector(".stat-value").textContent = value.toFixed(2);
          row.querySelector(".stat-fill").style.width = `${Math.round(value * 100)}%`;
          const delta = state.lastDelta[key] || 0;
          row.classList.remove("changed");
          row.querySelector(".stat-delta").textContent = delta ? signed(delta) : "";
          if (delta) {
            window.requestAnimationFrame(() => row.classList.add("changed"));
          }
        });
      }

      function renderInventory() {
        els.inventoryList.innerHTML = state.inventory.slice(-7).map((item) => `<li>${item}</li>`).join("");
      }

      function renderLog() {
        els.logList.innerHTML = state.history.slice(0, 5).map((entry) => `<li>T${entry.turn}: ${entry.text}</li>`).join("") || "<li>No decisions recorded.</li>";
      }

      function renderFactions() {
        els.factionMeta.innerHTML = Object.entries(state.factions).map(([name, value]) => `<span>${name} ${value}</span>`).join("");
      }

      async function choose(index, event) {
        if (scene.busy || state.ended) return;
        const choice = scene.current.choices[index];
        if (!choice) return;
        scene.busy = true;
        Array.from(els.choiceArea.children).forEach((button) => { button.disabled = true; });
        const rect = event.currentTarget.getBoundingClientRect();
        triggerBurn(rect.left + rect.width / 2, rect.top + rect.height / 2);
        sound.choice();
        state.applyChoice(choice);
        renderStats();
        renderInventory();
        renderLog();
        renderFactions();
        graphRenderer.trigger();
        sound.graph();
        if (state.ended) {
          setTimeout(showEnding, 760);
          scene.busy = false;
          return;
        }
        els.narrativeText.innerHTML = `<span class="loading-rune">+</span> The oracle is weighing the graph...`;
        try {
          const next = await narrativeEngine.generate(state, choice);
          scene.current = next;
        } finally {
          setTimeout(() => {
            renderAll();
            scene.busy = false;
          }, 420);
        }
      }

      function triggerBurn(x, y) {
        els.burnOverlay.style.setProperty("--burn-x", `${x}px`);
        els.burnOverlay.style.setProperty("--burn-y", `${y}px`);
        els.burnOverlay.classList.remove("active");
        void els.burnOverlay.offsetWidth;
        els.burnOverlay.classList.add("active");
      }

      function showEnding() {
        const ending = state.ending();
        els.endingTitle.textContent = ending.title;
        els.endingCopy.textContent = ending.copy;
        els.endingEmblem.innerHTML = endingSvg(ending.color);
        const beliefs = graph.beliefs();
        els.endingBars.innerHTML = Object.entries(beliefs).map(([key, value]) => {
          const meta = variableMeta[key];
          return `
            <div class="ending-bar" style="--bar-color:${meta.color}; color:${meta.color}">
              <div class="ending-bar-fill" style="height:${Math.max(5, Math.round(value * 100))}%"></div>
              <span>${meta.label}<br>${value.toFixed(2)}</span>
            </div>
          `;
        }).join("");
        els.endingScreen.classList.add("open");
        sound.ending();
      }

      function endingSvg(color) {
        return `
          <defs>
            <radialGradient id="endingGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0" stop-color="${color}" stop-opacity="0.72"/>
              <stop offset="0.48" stop-color="${color}" stop-opacity="0.22"/>
              <stop offset="1" stop-color="${color}" stop-opacity="0"/>
            </radialGradient>
          </defs>
          <circle cx="60" cy="60" r="56" fill="url(#endingGlow)"/>
          <path d="M60 10 L73 44 L110 44 L80 66 L92 104 L60 82 L28 104 L40 66 L10 44 L47 44 Z" fill="none" stroke="${color}" stroke-width="4" stroke-linejoin="round"/>
          <circle cx="60" cy="60" r="16" fill="${color}" opacity="0.24"/>
          <circle cx="60" cy="60" r="7" fill="${color}"/>
        `;
      }

      function restart() {
        window.location.reload();
      }

      function copyEnding() {
        const text = `${els.endingTitle.textContent}\n\n${els.endingCopy.textContent}\n\nFinal graph: ${JSON.stringify(graph.beliefs())}`;
        if (navigator.clipboard) {
          navigator.clipboard.writeText(text).catch(() => {});
        }
      }

      function bindControls() {
        document.getElementById("restartButton").addEventListener("click", restart);
        document.getElementById("playAgainButton").addEventListener("click", restart);
        document.getElementById("copyEndingButton").addEventListener("click", copyEnding);
        document.getElementById("muteButton").addEventListener("click", (event) => {
          sound.muted = !sound.muted;
          event.currentTarget.textContent = sound.muted ? "Sound Off" : "Sound On";
        });
        document.getElementById("fullscreenButton").addEventListener("click", toggleFullscreen);
        document.getElementById("graphToggle").addEventListener("click", (event) => {
          const panel = document.getElementById("graphPanel");
          panel.classList.toggle("open");
          event.currentTarget.setAttribute("aria-expanded", panel.classList.contains("open") ? "true" : "false");
          setTimeout(() => graphRenderer.resize(), 50);
        });
        document.addEventListener("keydown", (event) => {
          if (event.key.toLowerCase() === "f") toggleFullscreen();
        });
        document.getElementById("sceneStrip").addEventListener("pointermove", (event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const mx = ((event.clientX - rect.left) / rect.width - 0.5) * 14;
          const my = ((event.clientY - rect.top) / rect.height - 0.5) * 8;
          event.currentTarget.style.setProperty("--mx", mx.toFixed(2));
          event.currentTarget.style.setProperty("--my", my.toFixed(2));
        });
      }

      function toggleFullscreen() {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen?.();
        } else {
          document.exitFullscreen?.();
        }
      }

      function renderGameToText() {
        const activeChoices = (scene.current?.choices || []).map((choice, index) => ({
          index,
          text: choice.text,
          deltas: choice.factorHints,
          outcome: choice.outcome
        }));
        return JSON.stringify({
          coordinateSystem: "DOM UI with graph canvas origin at top-left, x right, y down.",
          mode: state.ended ? "ending" : scene.busy ? "resolving" : "playing",
          turn: state.turn,
          act: state.act(),
          location: state.location(),
          sceneTag: scene.current?.sceneTag,
          worldEvent: state.worldEvent,
          beliefs: graph.beliefs(),
          inventory: state.inventory,
          factions: state.factions,
          choices: activeChoices
        });
      }

      window.render_game_to_text = renderGameToText;
      window.advanceTime = (ms = 16) => {
        const frames = Math.max(1, Math.round(ms / (1000 / 60)));
        particles.step(frames);
        particles.draw();
        graphRenderer.draw(performance.now() + ms);
        return renderGameToText();
      };

      bindControls();
      renderAll();
    })();
