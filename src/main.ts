import { Vault, Plugin, TFile, App, Modal, MarkdownView, Notice } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import { defaultSettings, GamificationPluginSettings } from './settings';
import format from 'date-fns/format';
import {countLayer2AndLayer3Characters, rateProgressiveSummarization, rateLevelOfMaturity, rateOutlinks, rateInlinks, rateDirection, rateLengthFilename, rateNoteLength, getNumberOfOutlinks, countCharactersInActiveFile, count_inlinks, getFileCountMap, getFileMap } from './majuritycalculation'
import {findEarliestCreatedFile, findEarliestModifiedFile, findEarliestDateFile, monthsBetween, getCreationDates, getModificationDates, createChartFormat, replaceChartContent} from './creatmodchartcalculation'
import {getBadgeForLevel, getBadgeForInitLevel, checkIfReceiveABadge, Badge} from './badges' 
import {getLevelForPoints, LevelData, statusPointsForLevel} from './levels' 
import { isToday } from 'date-fns';
// import { Moment } from 'moment';
import type { Moment } from 'moment';

export default class gamification extends Plugin {
	//settings: gamificationSettings // überbleibsel aus dem Bsp.
	public settings: GamificationPluginSettings;
	private timerInterval: number;
  	private timerId: number | null;

	async onload() {
		console.log('obsidian-pkm-gamification loaded!');

		await this.loadSettings();

		// load settings tab für die Einstellungen
		this.addSettingTab(new GamificationPluginSettings(this.app, this));

		// take care to reset when opened on a new day, don't wait for trigger
		setTimeout(async () => {
			// Code that you want to execute after the delay
			this.resetDailyGoals()
		}, 2000); // 2000 milliseconds = 2 seconds

		/*
		// Register an event listener for the app:file-closed event
		this.app.workspace.on('window-close', async (file) => {
			// Check if the closed file has a specific tag
			console.log(`file got closed: ${file.getRoot.name}`);
		});
		*/
		

		// to set timer for reseting daily and weekly goals
		this.timerInterval = 30 * 60 * 1000; // Minuten x Sekunden x Millisekunden 
		this.timerId = window.setInterval(this.resetDailyGoals.bind(this), this.timerInterval);
		
		const item = this.addStatusBarItem();
	    let statusbarGamification = item.createEl("span", { text: "" });
		await this.updateStatusBar(statusbarGamification)

		
		if (this.settings.debug){
			this.addRibbonIcon("accessibility", "change text formatting", async () => {
				
				// const pointsReceived = 500;
				// new ModalInformationbox(this.app, `Finallized gamification initialistation!\nCongratulation, you earned ${pointsReceived} Points!\n\nCheck the Profile Page: \"${this.settings.avatarPageName}.md\".`).open();

				// const newLevel = this.giveStatusPoints(this.settings.avatarPageName, 300)
				// this.decisionIfBadge(newLevel)

				// const nextBadgeLevel = await this.whichLevelNextBadge(this.settings.statusLevel)
				// console.log(`Nächste Badge mit Level ${nextBadgeLevel}`)

				
				// const initBadge : Badge = await getBadgeForInitLevel(this.settings.statusLevel);
				// await this.giveInitBadgeInProfile(this.settings.avatarPageName, initBadge);
				// await this.removeBadgesWhenInitLevelHigher(this.settings.avatarPageName ,this.settings.statusLevel)
				// await this.boosterForInit()

				// this.openAvatarFile()


				// change text in status bar
				
				// this.updateStatusBar(statusbarGamification)
				//statusbarGamification.setText("Hallo")

				//this.loadSettings()
        		//this.resetDailyGoals()

				await this.loadSettings();
				this.updateAvatarPage(this.settings.avatarPageName);

				

			});
		}
		
		
		

		this.addRibbonIcon("sprout", "Calculate Note Maturity", async () => {
			//const file: TFile | null = this.app.workspace.getActiveFile();
			this.calculateNoteMajurity(statusbarGamification);
		});


		if (this.settings.enableInitCommand){
		// command Initialize gamification ratings
			this.addCommand({
				id: 'init-rate-gamification',
				name: 'Initialize gamification ratings',
				callback: async () => {
					this.settings.gamificationStartDate = format(new Date(), 'yyyy-MM-dd');
					this.saveSettings();

					const { vault } = this.app;
					await createAvatarFile(this.app, this.settings.avatarPageName)
					const chartString = await this.createChart(vault)
					await replaceChartContent(this.settings.avatarPageName, chartString)
					this.openAvatarFile()
					const fileCountMap: TFile[] = await getFileMap(this.app, this.settings.tagsExclude, this.settings.folderExclude);
					console.log(`fileCountMap loaded. Number of files: ${fileCountMap.length}`);
					
					let pointsReceived = 0; // to have one message at the end how many points received
					const pointsNoteMajurity = 100;
					const pointsMajurity = 10;
					let newLevel : Promise<boolean>;
					

					for (const fileName of fileCountMap) {
						let file = fileName
						const fileContents = await app.vault.read(file);
						const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
						if (activeView && activeView.file && activeView.file.path === file.path) {
							console.warn(`File ${file.path} is currently open. Skipping.`);
						continue;
						}
						//console.log(`fileName.basename: ${fileName.basename}`)
						const fileLength = countCharactersInActiveFile(fileContents, fileName.basename);
						const rateFileLength = rateNoteLength(fileLength);
						const {charCount, highlightedCount, boldCount} = countLayer2AndLayer3Characters(fileContents, fileName.basename, this.settings.progressiveSumLayer2, this.settings.progressiveSumLayer3);
						const rateProgressiveSum : number = rateProgressiveSummarization(charCount, highlightedCount, boldCount);
						const fileNameRate = rateLengthFilename(file.name);
						const inlinkNumber = count_inlinks(file);
						const inlinkClass = rateInlinks(inlinkNumber)//, fileCountMap.size);
						const rateOut = rateOutlinks(getNumberOfOutlinks(file));
						const noteMajurity = rateLevelOfMaturity(rateFileLength, fileNameRate, inlinkClass, rateOut, rateProgressiveSum);
						

						console.log(`Processing file ${fileName.basename} in path ${fileName.path}`);
											
						try {
							await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
							  	//console.log('current metadata: ', frontmatter);

							  	// Status Points
								if (rateDirectionForStatusPoints(frontmatter['note-maturity'], noteMajurity) >= 1){
									pointsReceived += pointsNoteMajurity*rateDirectionForStatusPoints(frontmatter['note-maturity'], noteMajurity)
									newLevel = this.giveStatusPoints(this.settings.avatarPageName,pointsNoteMajurity*rateDirectionForStatusPoints("frontmatter['note-maturity']", noteMajurity))

								} else if ('note-maturity' in frontmatter == false){
									pointsReceived += pointsNoteMajurity*rateDirectionForStatusPoints("0", noteMajurity)
									newLevel = this.giveStatusPoints(this.settings.avatarPageName,pointsNoteMajurity*rateDirectionForStatusPoints("0", noteMajurity))
								}

								if (rateDirectionForStatusPoints(frontmatter['title-class'], fileNameRate) >= 1 && 'title-class' in frontmatter){
									pointsReceived += pointsMajurity*rateDirectionForStatusPoints(frontmatter['title-class'], fileNameRate)
									newLevel = this.giveStatusPoints(this.settings.avatarPageName,pointsMajurity * rateDirectionForStatusPoints(frontmatter['title-class'], fileNameRate))
									
								} else if ('title-class' in frontmatter == false){
									pointsReceived += pointsMajurity*rateDirectionForStatusPoints("0", fileNameRate)
									newLevel = this.giveStatusPoints(this.settings.avatarPageName,pointsMajurity*rateDirectionForStatusPoints("0", fileNameRate))
									
								}

								if (rateDirectionForStatusPoints(frontmatter['note-length-class'], rateFileLength) >= 1){
									pointsReceived += pointsMajurity*rateDirectionForStatusPoints(frontmatter['note-length-class'], rateFileLength)
									newLevel = this.giveStatusPoints(this.settings.avatarPageName,pointsMajurity * rateDirectionForStatusPoints(frontmatter['note-length-class'], rateFileLength))
									
								}else if ('note-length-class' in frontmatter == false){
									pointsReceived += pointsMajurity*rateDirectionForStatusPoints("0", rateFileLength)
									newLevel = this.giveStatusPoints(this.settings.avatarPageName,pointsMajurity*rateDirectionForStatusPoints("0", rateFileLength))
									
								}

								if (rateDirectionForStatusPoints(frontmatter['inlink-class'], inlinkClass) >= 1){
									pointsReceived += pointsMajurity*rateDirectionForStatusPoints(frontmatter['inlink-class'], inlinkClass)
									newLevel = this.giveStatusPoints(this.settings.avatarPageName,pointsMajurity * rateDirectionForStatusPoints(frontmatter['inlink-class'], inlinkClass))
									
								}else if ('inlink-class' in frontmatter == false){
									pointsReceived += pointsMajurity*rateDirectionForStatusPoints("0", inlinkClass)
									newLevel = this.giveStatusPoints(this.settings.avatarPageName,pointsMajurity*rateDirectionForStatusPoints("0", inlinkClass))
									
								}

								if (rateDirectionForStatusPoints(frontmatter['outlink-class'], rateOut) >= 1){
									pointsReceived += pointsMajurity*rateDirectionForStatusPoints(frontmatter['outlink-class'], rateOut)
									newLevel = this.giveStatusPoints(this.settings.avatarPageName,pointsMajurity * rateDirectionForStatusPoints(frontmatter['outlink-class'], rateOut))
									
								}else if ('outlink-class' in frontmatter == false){
									pointsReceived += pointsMajurity*rateDirectionForStatusPoints("0", rateOut)
									newLevel = this.giveStatusPoints(this.settings.avatarPageName,pointsMajurity*rateDirectionForStatusPoints("0", rateOut))
									
								}

								if (rateDirectionForStatusPoints(frontmatter['progressive-sumarization-maturity'], rateProgressiveSum) >= 1){
									pointsReceived += pointsMajurity*rateDirectionForStatusPoints(frontmatter['progressive-sumarization-maturity'], rateProgressiveSum)
									newLevel = this.giveStatusPoints(this.settings.avatarPageName,pointsMajurity * rateDirectionForStatusPoints(frontmatter['progressive-sumarization-maturity'], rateProgressiveSum))
									
								}else if ('progressive-sumarization-maturity' in frontmatter == false){
									pointsReceived += pointsMajurity*rateDirectionForStatusPoints(frontmatter['progressive-sumarization-maturity'], rateProgressiveSum)
									newLevel = this.giveStatusPoints(this.settings.avatarPageName,pointsMajurity*rateDirectionForStatusPoints("0", rateProgressiveSum))
									
								}
								//console.log(`pointsReceived: ${pointsReceived}\tnext are frontmatters …`)

								
								frontmatter['title-class'] = rateDirection(frontmatter['title-class'], fileNameRate)
								frontmatter['note-length-class'] = rateDirection(frontmatter['note-length-class'], rateFileLength)
								frontmatter['inlink-class'] = rateDirection(frontmatter['inlink-class'], inlinkClass)
								frontmatter['outlink-class'] = rateDirection(frontmatter['outlink-class'], rateOut)
								frontmatter['progressive-sumarization-maturity'] = rateDirection(frontmatter['progressive-sumarization-maturity'], rateProgressiveSum)
								frontmatter['note-maturity'] = rateDirection(frontmatter['note-maturity'], noteMajurity)
								});	
						} catch (e) {
							if (e?.name === 'YAMLParseError') {const errorMessage = `Update majuritys failed Malformed frontamtter on this file : ${file.path} ${e.message}`;
							  new Notice(errorMessage, 4000);
							  console.error(errorMessage);
							}
						  }
					}
					if (pointsReceived > 0){
						new Notice(`${pointsReceived} Points received`)
						console.log(`${pointsReceived} Points received`)
					}
					
					// Inside your function where you want to introduce a delay
					setTimeout(async () => {
						// Code that you want to execute after the delay
						const initBadge : Badge = await getBadgeForInitLevel(this.settings.statusLevel);
						new Notice(`You've earned the "${initBadge.name}" badge. ${initBadge.description}`)
      					console.log(`You earned ${initBadge.name} - ${initBadge.description}`)
						await this.giveInitBadgeInProfile(this.settings.avatarPageName, initBadge);
						await this.removeBadgesWhenInitLevelHigher(this.settings.avatarPageName ,this.settings.statusLevel)
						await this.boosterForInit()
						await this.updateStatusBar(statusbarGamification)
					}, 2000); // 2000 milliseconds = 2 seconds


					// const initBadge : Badge = await getBadgeForInitLevel(this.settings.statusLevel)
					// await this.giveInitBadgeInProfile(this.settings.avatarPageName ,initBadge)
					// await this.removeBadgesWhenInitLevelHigher(this.settings.avatarPageName ,this.settings.statusLevel)
					// await this.boosterForInit()
				
					
					new ModalInformationbox(this.app, `Finallized gamification initialistation!\nCongratulation, you earned ${pointsReceived} Points!\n\nCheck the Profile Page: \"${this.settings.avatarPageName}.md\"\n\nYou received an initialisation Booster aktiv for your first level ups. Game on!`).open();
					
				},
			});
		}

		if (this.settings.enableInitCommand){
			// command create avatar profile page
				this.addCommand({
					id: 'create-avatar-page',
					name: 'create profile page',
					callback: async () => {
						const { vault } = this.app;
						createAvatarFile(this.app, this.settings.avatarPageName)
						const chartString = await this.createChart(vault)
						replaceChartContent(this.settings.avatarPageName, chartString)
					},
				});
			}


		// command: reset game
		this.addCommand({
			id: 'reset-game',
			name: 'reset the game',
			callback: async () => {
				//const app = window.app;
				// wenn es keine einschränkung gibt ist es wesentlich schneller
				//const files = await getFileMap(app, this.settings.tagsExclude, this.settings.folderExclude);
				await this.removeKeysFromFrontmatter();
				this.settings.statusLevel = 1;
				this.settings.statusPoints = 0;
				this.settings.xpForNextLevel = 1000
				this.settings.badgeBoosterState = false
				this.settings.badgeBoosterFactor = 1
				await this.saveData(this.settings);
				this.giveStatusPoints(this.settings.avatarPageName,0)
				await this.updateStatusBar(statusbarGamification)
				new ModalInformationbox(this.app, `Game is now reseted. Please delete the Profile Page: \"${this.settings.avatarPageName}.md\" manually.`).open();
			},
			
		});

		// command: update chart in Avatar Page
		this.addCommand({
			id: 'update-chart-avatarpage',
			name: 'update chart on profile page',
			callback: async () => {
				//const app = window.app;
				// wenn es keine einschränkung gibt ist es wesentlich schneller
				//const files = await getFileMap(app, this.settings.tagsExclude, this.settings.folderExclude);
				const { vault } = app;
				const chartString = await this.createChart(vault)
				replaceChartContent(this.settings.avatarPageName, chartString)
			},
		});

		/*
		// command: rate filename
		this.addCommand({
			id: 'rate-filename-length',
			name: 'Rate Filename Length',
			callback: async () => {
				const file: TFile | null = this.app.workspace.getActiveFile();
				if (file) {
					try {
						await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
						  	//console.log('current metadata: ', frontmatter);
						  	const pointsNoteMajurity = 100;
							const pointsMajurity = 10;
							if (rateDirectionForStatusPoints(frontmatter['title-class'], rateLengthFilename(file.name)) >= 1){
								new Notice(`${pointsMajurity * rateDirectionForStatusPoints(frontmatter['title-class'], rateLengthFilename(file.name))} Points received`)
								this.giveStatusPoints(this.settings.avatarPageName,pointsMajurity * rateDirectionForStatusPoints(frontmatter['title-class'], rateLengthFilename(file.name)))
							}
						  	frontmatter['title-class'] = rateDirection(frontmatter['title-class'], rateLengthFilename(file.name))
						});	
					} catch (e) {
						if (e?.name === 'YAMLParseError') {
						  const errorMessage = `Update titel majurity failed Malformed frontamtter on this file : ${file.path}
				  
				  ${e.message}`;
						  new Notice(errorMessage, 4000);
						  console.error(errorMessage);
						}
					  }
				}
				await this.updateStatusBar(statusbarGamification)
			},
		});

		// command: rate outlinks
		this.addCommand({
			id: 'rate-outlinks',
			name: 'Rate outlinks',
			callback: async () => {
				const file: TFile | null = this.app.workspace.getActiveFile();
				if (file) {
					try {
						await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
							const pointsMajurity = 10;
							if (rateDirectionForStatusPoints(frontmatter['outlink-class'], rateLengthFilename(file.name)) >= 1){
								new Notice(`${pointsMajurity * rateDirectionForStatusPoints(frontmatter['outlink-class'], rateLengthFilename(file.name))} Points received`)
								this.giveStatusPoints(this.settings.avatarPageName,pointsMajurity * rateDirectionForStatusPoints(frontmatter['outlink-class'], rateLengthFilename(file.name)))
							}
						  	//console.log('current metadata: ', frontmatter);
						  	frontmatter['outlink-class'] = rateDirection(frontmatter['outlink-class'], rateOutlinks(getNumberOfOutlinks(file)))
						});	
					} catch (e) {
						if (e?.name === 'YAMLParseError') {
						  const errorMessage = `Update outlink majurity failed
				  Malformed frontamtter on this file : ${file.path}
				  
				  ${e.message}`;
						  new Notice(errorMessage, 4000);
						  console.error(errorMessage);
						}
					  }
				}
				await this.updateStatusBar(statusbarGamification)
			},
		});


		// command: rate inlinks
		this.addCommand({
			id: 'rate-inlinks',
			name: 'Rate inlinks',
			callback: async () => {
				const app = window.app;
				// const countMap = await getFileCountMap(app, this.settings.tagsExclude, this.settings.folderExclude);
				const file: TFile  = this.app.workspace.getActiveFile();
				// const basePath = (this.app.vault.adapter as any).basePath
				const inlinkNumber = count_inlinks(file);
				const inlinkClass = rateInlinks(inlinkNumber)//, numAllFiles)
				try {
					await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
					  	//console.log('current metadata: ', frontmatter);
						const pointsMajurity = 10;
						if (rateDirectionForStatusPoints(frontmatter['inlink-class'], rateLengthFilename(file.name)) >= 1){
							new Notice(`${pointsMajurity * rateDirectionForStatusPoints(frontmatter['inlink-class'], rateLengthFilename(file.name))} Points received`)
							this.giveStatusPoints(this.settings.avatarPageName,pointsMajurity * rateDirectionForStatusPoints(frontmatter['inlink-class'], rateLengthFilename(file.name)))
						}
					 	frontmatter['inlink-class'] = rateDirection(frontmatter['inlink-class'], inlinkClass)
					});	
				} catch (e) {
					if (e?.name === 'YAMLParseError') {
					  const errorMessage = `Update inlink majurity failed
			  Malformed frontamtter on this file : ${file.path}
			  
			  ${e.message}`;
					  new Notice(errorMessage, 4000);
					  console.error(errorMessage);
					}
				  }
				  await this.updateStatusBar(statusbarGamification)
			},
		});


		// command: rate length of file content
		this.addCommand({
			id: 'rate-filenlength',
			name: 'Rate Length of file',
			callback: async () => {
				const file: TFile  = this.app.workspace.getActiveFile();
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				// Get the full text of the file
				const fileContents = activeView.editor.getValue();
				const fileName = activeView.file.basename;
				const fileLength = countCharactersInActiveFile(fileContents, fileName)
				
				try {
					await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
						//console.log('current metadata: ', frontmatter);
						const pointsMajurity = 10;
						if (rateDirectionForStatusPoints(frontmatter['note-length-class'], rateLengthFilename(file.name)) >= 1){
							new Notice(`${pointsMajurity * rateDirectionForStatusPoints(frontmatter['note-length-class'], rateLengthFilename(file.name))} Points received`)
							this.giveStatusPoints(this.settings.avatarPageName,pointsMajurity * rateDirectionForStatusPoints(frontmatter['note-length-class'], rateLengthFilename(file.name)))
						}
					  	frontmatter['note-length-class'] = rateDirection(frontmatter['note-length-class'], fileLength)
					});	
				} catch (e) {
					if (e?.name === 'YAMLParseError') {
					  const errorMessage = `Update inlink majurity failed
			  Malformed frontamtter on this file : ${file.path}
			  
			  ${e.message}`;
					  new Notice(errorMessage, 4000);
					  console.error(errorMessage);
					}
				}
				await this.updateStatusBar(statusbarGamification)
			},
		});

		// command: rate title length
		this.addCommand({
			id: 'rate-titellength',
			name: 'Rate Length of titel',
			callback: async () => {
				const file: TFile  = this.app.workspace.getActiveFile();
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				// Get the full text of the file
				const fileContents = activeView.editor.getValue();
				const fileName = activeView.file.basename;
				const fileNameRate = rateLengthFilename(file.name)
				
				try {
					await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
						//console.log('current metadata: ', frontmatter);
						const pointsMajurity = 10;
						if (rateDirectionForStatusPoints(frontmatter['title-class'], rateLengthFilename(file.name)) >= 1){
							new Notice(`${pointsMajurity * rateDirectionForStatusPoints(frontmatter['title-class'], rateLengthFilename(file.name))} Points received`)
							this.giveStatusPoints(this.settings.avatarPageName,pointsMajurity * rateDirectionForStatusPoints(frontmatter['title-class'], rateLengthFilename(file.name)))
						}
					  	frontmatter['title-class'] = rateDirection(frontmatter['title-class'], fileNameRate)
					});	
				} catch (e) {
					if (e?.name === 'YAMLParseError') {
					  const errorMessage = `Update tile length majurity failed
			  Malformed frontamtter on this file : ${file.path}
			  
			  ${e.message}`;
					  new Notice(errorMessage, 4000);
					  console.error(errorMessage);
					}
				}
				await this.updateStatusBar(statusbarGamification)
			},
		});
		*/
		
		// command: rate note maturity
		this.addCommand({
			id: 'rate-note-maturity',
			name: 'Rate note majurity',
			callback: async () => {
				this.calculateNoteMajurity(statusbarGamification);
			},
		});
		

		// command: change progressive summarzation symbols
		this.addCommand({
			id: 'change-progressive-formatting',
			name: 'toggle progressive summarization formatting',
			callback: async () => {
				replaceFormatStrings(this.settings.progressiveSumLayer2, this.settings.progressiveSumLayer3);
			},
		});

		
		

	}
  

	onunload() {
		console.log('obsidian-pkm-gamification unloaded!');
		
		// Clear the timer when the plugin is unloaded
		if (this.timerId !== null) {
			clearInterval(this.timerId);
			this.timerId = null;
		  }
	}

	async calculateNoteMajurity(statusbarGamification: HTMLSpanElement){
		const file: TFile | null= this.app.workspace.getActiveFile();
			if (file == null) {
				console.error('got no file, propably none is active')
			}
		
			// to detect if NoteIsFirstlyRated
			let firstTimeNoteRating = false;

			// get file content length
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			const fileContents = activeView?.editor.getValue();
			const fileName = activeView?.file.basename;

			let rateFileLength = 0;
			let fileLength = 0;
			let rateProgressiveSum = 0;

			if (fileContents !== undefined && fileName !== undefined) {
				fileLength = countCharactersInActiveFile(fileContents, fileName);
				rateFileLength = rateNoteLength(fileLength);

				// Check if fileContents and fileName are not null
				if (fileContents !== null && fileName !== null) {
					const { charCount, highlightedCount, boldCount } = countLayer2AndLayer3Characters(fileContents, fileName, this.settings.progressiveSumLayer2, this.settings.progressiveSumLayer3);
					rateProgressiveSum = rateProgressiveSummarization(charCount, highlightedCount, boldCount);
				}
			}

			let fileNameRate = 0;
			let inlinkNumber = 0;
			let inlinkClass = 0;
			let rateOut = 0;
			
			if (file !== null) {
				fileNameRate = rateLengthFilename(file.name ?? '');
				inlinkNumber = count_inlinks(file);
				inlinkClass = rateInlinks(inlinkNumber)//, numAllFiles)
				rateOut = rateOutlinks(getNumberOfOutlinks(file));

				const noteMajurity = rateLevelOfMaturity(rateFileLength, fileNameRate, inlinkClass, rateOut, rateProgressiveSum);
				
				try {
					await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
						if (frontmatter) {
							const pointsNoteMajurity = 100;
							const pointsMajurity = 10;
							let pointsReceived = 0; // to have one message at the end how many points received
							if (rateDirectionForStatusPoints(frontmatter['note-maturity'], noteMajurity) >= 1){
								pointsReceived += pointsNoteMajurity*rateDirectionForStatusPoints(frontmatter['note-maturity'], noteMajurity)
								const newLevel = this.giveStatusPoints(this.settings.avatarPageName,pointsNoteMajurity*rateDirectionForStatusPoints("frontmatter['note-maturity']", noteMajurity))
								this.decisionIfBadge(newLevel)
							} else if (!('note-maturity' in frontmatter)){
								pointsReceived += pointsNoteMajurity*rateDirectionForStatusPoints("0", noteMajurity)
								const newLevel = this.giveStatusPoints(this.settings.avatarPageName,pointsNoteMajurity*rateDirectionForStatusPoints("0", noteMajurity))
								this.decisionIfBadge(newLevel);
								firstTimeNoteRating = true;
							}

							if (rateDirectionForStatusPoints(frontmatter['title-class'], fileNameRate) >= 1 && 'title-class' in frontmatter){
								pointsReceived += pointsMajurity*rateDirectionForStatusPoints(frontmatter['title-class'], fileNameRate)
								const newLevel = this.giveStatusPoints(this.settings.avatarPageName,pointsMajurity * rateDirectionForStatusPoints(frontmatter['title-class'], fileNameRate))
								this.decisionIfBadge(newLevel)
							} else if (!('title-class' in frontmatter)){
								pointsReceived += pointsMajurity*rateDirectionForStatusPoints("0", fileNameRate)
								const newLevel = this.giveStatusPoints(this.settings.avatarPageName,pointsMajurity*rateDirectionForStatusPoints("0", fileNameRate))
								this.decisionIfBadge(newLevel)
							}

							if (rateDirectionForStatusPoints(frontmatter['note-length-class'], rateFileLength) >= 1){
								pointsReceived += pointsMajurity*rateDirectionForStatusPoints(frontmatter['note-length-class'], rateFileLength)
								const newLevel = this.giveStatusPoints(this.settings.avatarPageName,pointsMajurity * rateDirectionForStatusPoints(frontmatter['note-length-class'], rateFileLength))
								this.decisionIfBadge(newLevel)
							}else if (!('note-length-class' in frontmatter)){
								pointsReceived += pointsMajurity*rateDirectionForStatusPoints("0", rateFileLength)
								const newLevel = this.giveStatusPoints(this.settings.avatarPageName,pointsMajurity*rateDirectionForStatusPoints("0", rateFileLength))
								this.decisionIfBadge(newLevel)
							}

							if (rateDirectionForStatusPoints(frontmatter['inlink-class'], inlinkClass) >= 1){
								pointsReceived += pointsMajurity*rateDirectionForStatusPoints(frontmatter['inlink-class'], inlinkClass)
								const newLevel = this.giveStatusPoints(this.settings.avatarPageName,pointsMajurity * rateDirectionForStatusPoints(frontmatter['inlink-class'], inlinkClass))
								this.decisionIfBadge(newLevel)
							}else if (!('inlink-class' in frontmatter)){
								pointsReceived += pointsMajurity*rateDirectionForStatusPoints("0", inlinkClass)
								const newLevel = this.giveStatusPoints(this.settings.avatarPageName,pointsMajurity*rateDirectionForStatusPoints("0", inlinkClass))
								this.decisionIfBadge(newLevel)
							}

							if (rateDirectionForStatusPoints(frontmatter['outlink-class'], rateOut) >= 1){
								pointsReceived += pointsMajurity*rateDirectionForStatusPoints(frontmatter['outlink-class'], rateOut)
								const newLevel = this.giveStatusPoints(this.settings.avatarPageName,pointsMajurity * rateDirectionForStatusPoints(frontmatter['outlink-class'], rateOut))
								this.decisionIfBadge(newLevel)
							}else if (!('outlink-class' in frontmatter)){
								pointsReceived += pointsMajurity*rateDirectionForStatusPoints("0", rateOut)
								const newLevel = this.giveStatusPoints(this.settings.avatarPageName,pointsMajurity*rateDirectionForStatusPoints("0", rateOut))
								this.decisionIfBadge(newLevel)
							}

							if (rateDirectionForStatusPoints(frontmatter['progressive-sumarization-maturity'], rateProgressiveSum) >= 1){
								pointsReceived += pointsMajurity*rateDirectionForStatusPoints(frontmatter['progressive-sumarization-maturity'], rateProgressiveSum)
								const newLevel = this.giveStatusPoints(this.settings.avatarPageName,pointsMajurity * rateDirectionForStatusPoints(frontmatter['progressive-sumarization-maturity'], rateProgressiveSum))
								this.decisionIfBadge(newLevel)
							}else if (!('progressive-sumarization-maturity' in frontmatter)){
								pointsReceived += pointsMajurity*rateDirectionForStatusPoints(frontmatter['progressive-sumarization-maturity'], rateProgressiveSum)
								const newLevel = this.giveStatusPoints(this.settings.avatarPageName,pointsMajurity*rateDirectionForStatusPoints("0", rateProgressiveSum))
								this.decisionIfBadge(newLevel)
							}

							if (pointsReceived > 0){
								new Notice(`${pointsReceived * this.settings.badgeBoosterFactor} Points received`)
								console.log(`${pointsReceived} Points received`)
							}

							frontmatter['title-class'] = rateDirection(frontmatter['title-class'], fileNameRate)
							frontmatter['note-length-class'] = rateDirection(frontmatter['note-length-class'], rateFileLength)
							frontmatter['inlink-class'] = rateDirection(frontmatter['inlink-class'], inlinkClass)
							frontmatter['outlink-class'] = rateDirection(frontmatter['outlink-class'], rateOut)
							frontmatter['progressive-sumarization-maturity'] = rateDirection(frontmatter['progressive-sumarization-maturity'], rateProgressiveSum)
							frontmatter['note-maturity'] = rateDirection(frontmatter['note-maturity'], noteMajurity)
						}
					});
				} catch (e) {
					if (e?.name === 'YAMLParseError') {
					const errorMessage = `Update majuritys failed Malformed frontamtter on this file : ${file.path} ${e.message}`;
					new Notice(errorMessage, 4000);
					console.error(errorMessage);
					}
				}
				new Notice('note majurity updated!');
				await this.updateStatusBar(statusbarGamification)
			} else {
				console.error('file was not found to calculate majurities. Make sure one is active.')
			}
			if (firstTimeNoteRating){
				await this.increaseDailyCreatedNoteCount();
				await this.increaseWeeklyCreatedNoteCount();
			}
	}


	async resetDailyGoals(){
		let reset : Boolean = false;
		if(!isSameDay(window.moment(this.settings.dailyNoteCreationDate, 'DD.MM.YYYY'))){
			this.settings.dailyNoteCreationTask = 0;
			this.settings.dailyNoteCreationDate = window.moment().format('DD.MM.YYYY')
			this.saveSettings();
			console.log(`daily Challenge reseted`)
			reset = true;
		}
		if(!isOneDayBefore(window.moment(this.settings.weeklyNoteCreationDate, 'DD.MM.YYYY')) && !isSameDay(window.moment(this.settings.dailyNoteCreationDate, 'DD.MM.YYYY'))){
			this.settings.weeklyNoteCreationTask = 0;
			this.settings.weeklyNoteCreationDate = window.moment().subtract(1, 'day').format('DD.MM.YYYY')
			this.saveSettings();
			console.log(`weekly Challenge reseted`)
			reset = true;
		}
		if(!isOneDayBefore(window.moment(this.settings.weeklyNoteCreationDate, 'DD.MM.YYYY')) && this.settings.weeklyNoteCreationTask == 7){
			reset = true;
		}
		if (reset){
			//this.dailyChallengeUpdateProfile(this.settings.avatarPageName, 0)
			this.updateAvatarPage(this.settings.avatarPageName);
		}
		
	}

	async increaseDailyCreatedNoteCount(){
		let newDailyNoteCreationTask = this.settings.dailyNoteCreationTask;
		if (newDailyNoteCreationTask < 2){
			newDailyNoteCreationTask ++;
			this.settings.dailyNoteCreationTask = newDailyNoteCreationTask;
			this.saveSettings();
			
			if(newDailyNoteCreationTask == 1){
				// update Avatar Page
				this.updateAvatarPage(this.settings.avatarPageName);
				console.log(`${newDailyNoteCreationTask}/2 Notes created today.`)
			} else if (newDailyNoteCreationTask == 2) {
				this.giveStatusPoints(this.settings.avatarPageName, 500)
				console.log(`daily Challenge reached! ${newDailyNoteCreationTask}/2 created.`)
			} else {
				// nothing else to do here 
				console.log(`${newDailyNoteCreationTask}/2 Notes created today.`)
			}
		}
	}

	async increaseWeeklyCreatedNoteCount(){
		console.log(`increaseWeeklyCreatedNoteCount called …`)
		if(isOneDayBefore(window.moment(this.settings.weeklyNoteCreationDate, 'DD.MM.YYYY'))){
			let newWeeklyNoteCreationTask = this.settings.weeklyNoteCreationTask;
			if (newWeeklyNoteCreationTask < 7){
				newWeeklyNoteCreationTask ++;
				this.settings.weeklyNoteCreationDate = window.moment().format('DD.MM.YYYY')
				this.settings.weeklyNoteCreationTask = newWeeklyNoteCreationTask;
				this.saveSettings();
				
				if(newWeeklyNoteCreationTask <= 6){
					// update Avatar Page
					this.updateAvatarPage(this.settings.avatarPageName);
					console.log(`${newWeeklyNoteCreationTask}/7 Notes created in a chain.`)
				} else if (newWeeklyNoteCreationTask == 7) {
					this.giveStatusPoints(this.settings.avatarPageName, 2000)
					console.log(`Weekly Challenge reached! ${newWeeklyNoteCreationTask}/7 created in a chain.`)
				} else {
					// nothing else to do here 
					console.log(`${newWeeklyNoteCreationTask}/7 Notes created in a chain.`)
				}
			}
		} else if (isSameDay(window.moment(this.settings.dailyNoteCreationDate, 'DD.MM.YYYY'))){
			// do nothing
			console.log(`daily note creation was rated already today.`)
		} else {
			this.settings.weeklyNoteCreationDate = window.moment().format('DD.MM.YYYY')
			this.settings.weeklyNoteCreationTask = 1;
			this.saveSettings();
		}
	}

	async updateStatusBar(statusbar: HTMLSpanElement){
		/*
		writes current level und calculates with 10 ticks precision a progressbar.
		---
		alpha: status points to reach CURRENT level | level.points
		beta: status points to reach NEXT level | level.pointsNext
		gamma: current status points | settings.statusPoints
		prozent = (gamma - alpha) / (beta - alpha) * 100%
		*/

		const level = getLevelForPoints(this.settings.statusPoints)
		const progressbarPercent = (this.settings.statusPoints - level.points)/(level.pointsNext - level.points)*100;
		const charNumProgressbar = 10
		let balken = Math.round(progressbarPercent / charNumProgressbar)
		let progressbar = ''
		for (let i=1; i <= charNumProgressbar; i++){
			if (i <= balken){
				progressbar += '='
			} else {
				progressbar += '-'
			}
		}
		statusbar.setText(`🎲|lvl: ${this.settings.statusLevel} | ${progressbar}`)
	}

	async loadSettings() {
		this.settings = Object.assign({}, defaultSettings, await this.loadData());
		console.log('loadSettings()')
	}


	async saveSettings() {
		await this.saveData(this.settings);
	}	


	async getCreationTime(file: TFile): Promise<Date> {
		const filePath = path.join(this.app.vault.getResourcePath(file)); // path.join(this.obsidian.vault.path, file);
		const creationTime = fs.statSync(filePath).ctime;
		return new Date(creationTime);
	  }  
	  

	async giveStatusPoints(avatarPageName: string, pointsToAdd: number): Promise<boolean>{
		/*
		const existingFile = app.vault.getAbstractFileByPath(`${avatarPageName}.md`);
		if (existingFile == null) {
			console.log(`File ${avatarPageName}.md does not exist`);
			return false;
			}
		const file = existingFile as TFile;
		*/
		// booster Faktor for Points
		let boosterFactor = 1;
		//load from settings if booster is aktiv
		if (this.settings.badgeBoosterState == true){
			boosterFactor = this.settings.badgeBoosterFactor;
		}

		/*
		//console.log(`current statusPoints: ${this.settings.statusPoints}`)
		const content = await app.vault.read(file);
		let reference: number | null = null;
		let end: number | null = null;
		let start: number | null = null;
	
		const lines = content.split("\n");
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();
			if (line === "^levelAndPoints") {
				if (reference === null) {
					reference = i;
				}
			}
		}
		*/
		// read current Points from settings
		const newPoints = pointsToAdd * boosterFactor + this.settings.statusPoints
		
		// write to settings value
		this.settings.statusPoints = newPoints
		await this.saveData(this.settings)

		const receiveBadge = this.updateAvatarPage(this.settings.avatarPageName);
		
		/*
		const level = getLevelForPoints(newPoints);
		let newLevel = 0;
		let nextLevelAt = this.settings.xpForNextLevel;
		let receiveBadge: boolean = false
		if (this.settings.statusLevel < level.level){
			// Level Up archived
			new Notice(`With ${newPoints} points, the current level is ${level.level}.`)
			// check first if this means a new badge
			receiveBadge = checkIfReceiveABadge(this.settings.statusLevel, level.level)
			this.settings.statusLevel = level.level;
			newLevel = level.level;
			nextLevelAt = level.pointsNext;
			this.settings.xpForNextLevel = level.pointsNext;
			await this.saveData(this.settings)
		}

		const progressBarEnd = nextLevelAt - newPoints;
		//console.log(`newPoints: ${newPoints}\nnextLevel@: ${nextLevelAt}\nproglessBarEnd: ${progressBarEnd}`)
		const newPointsString = '| Level  | ' + level.level + ' |\n| Points | ' + newPoints + '    |\n^levelAndPoints\n\`\`\`chart\ntype: bar\nlabels: [Expririence]\nseries:\n  - title: points reached\n    data: [' + newPoints + ']\n  - title: points to earn to level up\n    data: [' + progressBarEnd + ']\nxMin: ' + level.points + '\nxMax: ' + level.pointsNext + '\ntension: 0.2\nwidth: 40%\nlabelColors: false\nfill: false\nbeginAtZero: false\nbestFit: false\nbestFitTitle: undefined\nbestFitNumber: 0\nstacked: true\nindexAxis: y\nxTitle: "progress"\nlegend: false\n\`\`\`'
		if (reference != null){
			end = reference + 24;
			start = reference - 2;
			const newLines = [...lines.slice(0, start), newPointsString, ...lines.slice(end)];
			await app.vault.modify(file, newLines.join("\n"));
		}
		//console.log(`newLevel: ${newLevel}\npointsToAdd: ${pointsToAdd * boosterFactor}`)
		//new Notice(`${pointsToAdd * boosterFactor} points received`)
		*/
		return receiveBadge
		
		
	}  


	async updateAvatarPage(avatarPageName: string): Promise<boolean>{
		const existingFile = app.vault.getAbstractFileByPath(`${avatarPageName}.md`);
		if (existingFile == null) {
			console.log(`File ${avatarPageName}.md does not exist`);
			return false;
			}
		const file = existingFile as TFile;
		

		//console.log(`current statusPoints: ${this.settings.statusPoints}`)
		const content = await app.vault.read(file);
		let reference: number | null = null;
		let reference2: number | null = null;
		let reference3: number | null = null;
		let end: number | null = null;
		let start: number | null = null;
		let end2: number | null = null;
		let start2: number | null = null;
		let end3: number | null = null;
		let start3: number | null = null;
	
		const lines = content.split("\n");
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();
			if (line === "^levelAndPoints") {
				if (reference === null) {
					reference = i;
				}
			}
			if (line === "^dailyNotesChallenge") {
				if (reference2 === null) {
					reference2 = i;
				}
			}
			if (line === "^weeklyNotesChallenge") {
				if (reference3 === null) {
					reference3 = i;
				}
			}
		}
		// read current Points from settings
		const newPoints = this.settings.statusPoints
		
		const level = getLevelForPoints(newPoints);
		let newLevel = 0;
		let nextLevelAt = this.settings.xpForNextLevel;
		let receiveBadge: boolean = false
		if (this.settings.statusLevel < level.level){
			// Level Up archived
			new Notice(`With ${newPoints} points, the current level is ${level.level}.`)
			// check first if this means a new badge
			receiveBadge = checkIfReceiveABadge(this.settings.statusLevel, level.level)
			this.settings.statusLevel = level.level;
			newLevel = level.level;
			nextLevelAt = level.pointsNext;
			this.settings.xpForNextLevel = level.pointsNext;
			await this.saveData(this.settings)
		}

		const progressBarEnd = nextLevelAt - newPoints;
		//console.log(`newPoints: ${newPoints}\nnextLevel@: ${nextLevelAt}\nproglessBarEnd: ${progressBarEnd}`)
		const newPointsString = '| **Level**  | **' + level.level + '** |\n| Points | ' + newPoints + '    |\n^levelAndPoints\n\`\`\`chart\ntype: bar\nlabels: [Expririence]\nseries:\n  - title: points reached\n    data: [' + newPoints + ']\n  - title: points to earn to level up\n    data: [' + progressBarEnd + ']\nxMin: ' + level.points + '\nxMax: ' + level.pointsNext + '\ntension: 0.2\nwidth: 40%\nlabelColors: false\nfill: false\nbeginAtZero: false\nbestFit: false\nbestFitTitle: undefined\nbestFitNumber: 0\nstacked: true\nindexAxis: y\nxTitle: "progress"\nlegend: false\n\`\`\`'
		const dailyChallenge = '| **daily Notes** | *500EP* | **' + this.settings.dailyNoteCreationTask + '/2**   |';
		const daysLeftInWeeklyChain : number = 7 - this.settings.weeklyNoteCreationTask;
		const weeklyChallenge = '| **weekly Notes** | *2000EP*     |  **' + this.settings.weeklyNoteCreationTask + '/7**   |\n^weeklyNotesChallenge\n\`\`\`chart\ntype: bar\nlabels: [days done in a row]\nseries:\n  - title: days to do in a row\n    data: [' + this.settings.weeklyNoteCreationTask + ']\n  - title: points to earn to level up\n    data: [' + daysLeftInWeeklyChain + ']\nxMin: 0\nxMax: 7\ntension: 0.2\nwidth: 40%\nlabelColors: false\nfill: false\nbeginAtZero: false\nbestFit: false\nbestFitTitle: undefined\nbestFitNumber: 0\nstacked: true\nindexAxis: y\nxTitle: "progress"\nlegend: false\n\`\`\`';
		
		if (reference != null && reference2 != null && reference3 != null){
			start = reference - 2;
			end = reference + 24;
			start2 = reference2 - 1 - 25; // no idea wby offset 25 is needed
			end2 = reference2 - 25; // no idea wby offset 25 is needed
			start3 = reference3 - 1 -25; // no idea wby offset 25 is needed
			end3 = reference3 + 24 -25; // no idea wby offset 25 is needed
			
			
			const newLines = [...lines.slice(0, start), newPointsString, ...lines.slice(end)];
			const newLines2 = [...newLines.slice(0, start2), dailyChallenge, ...newLines.slice(end2)];
			const newLines3 = [...newLines2.slice(0, start3), weeklyChallenge, ...newLines2.slice(end3)];
			await app.vault.modify(file, newLines3.join("\n"));
		}
		return receiveBadge
	}  


	async giveBadgeInProfile(avatarPageName: string, badge: Badge){
		const existingFile = app.vault.getAbstractFileByPath(`${avatarPageName}.md`);
		if (existingFile == null) {
			console.log(`File ${avatarPageName}.md does not exist`);
			return;
			}
		const file = existingFile as TFile;
	
		const content = await app.vault.read(file);
		let reference: number | null = null;
		let reference2: number | null = null;
		let end: number | null = null;
		let start: number | null = null;
		let end2: number | null = null;
		let start2: number | null = null;
	
		const lines = content.split("\n");
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();
			if (line === "#### achieved") {
				if (reference === null) {
					reference = i;
				}
			}
			if (line === badge.level + ": *" + badge.name + "*"){
				if (reference2 === null) {
					reference2 = i;
				}
			}
		}
		if (reference != null && reference2 != null){
			end = reference + 1;
			start = reference + 1;
			
			end2 = reference2 + 2;
			start2 = reference2 + 1;
			
			const badgeString = "**" + badge.name + "** " + badge.level + "\n> " + badge.description + "\n"
			const newLines = [...lines.slice(0, start), badgeString, ...lines.slice(end)];
			const newLines2 = [...newLines.slice(0, start2), ...newLines.slice(end2)]
			await app.vault.modify(file, newLines2.join("\n"));
			console.log(`badgeString: ${badgeString}`)
		}
	}  

	async giveInitBadgeInProfile(avatarPageName: string, badge: Badge){
		const existingFile = app.vault.getAbstractFileByPath(`${avatarPageName}.md`);
		if (existingFile == null) {
			console.log(`File ${avatarPageName}.md does not exist`);
			return;
			}
		const file = existingFile as TFile;
	
		const content = await app.vault.read(file);
		let reference: number | null = null;
		let end: number | null = null;
		let start: number | null = null;
		
		const lines = content.split("\n");
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();
			if (line === "#### achieved") {
				if (reference === null) {
					reference = i;
				}
			}
		}
		if (reference != null ){
			end = reference + 2;
			start = reference + 1;
			
			const badgeString = "**" + badge.name + "**\n> " + badge.description + "\n"
			const newLines = [...lines.slice(0, start), badgeString, ...lines.slice(end)];
			await app.vault.modify(file, newLines.join("\n"));
			console.log(`badgeString: ${badgeString}`)
		}
	}
	
	async removeBadgesWhenInitLevelHigher(avatarPageName: string, level: number){
		const existingFile = app.vault.getAbstractFileByPath(`${avatarPageName}.md`);
		if (existingFile == null) {
			console.log(`File ${avatarPageName}.md does not exist`);
			return;
			}
		const file = existingFile as TFile;
	
		const content = await app.vault.read(file);
		let reference: number | null = null;
		let reference2: number | null = null;
		let end: number | null = null;
		let start: number | null = null;
		
		const lines = content.split("\n");
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();
			if (line === "#### outstanding") {
				if (reference === null) {
					reference = i;
				}
			}
			if (reference != null && reference2 == null){
				// Regular expression to match the level number
				const levelRegex = /level (\d+)/;
				// Extract the level number using the regular expression
				const match = line.match(levelRegex);

				if(match){
					const levelNumber = parseInt(match[1], 10); // Convert the matched number to an integer
					if (levelNumber < level) {
					} else {
						reference2 = i
					}
				} 
			}			
		}
		if (reference != null && reference2 != null){
			start = reference + 1;
			end = reference2;
			const newLines = [...lines.slice(0, start), ...lines.slice(end)];
			await app.vault.modify(file, newLines.join("\n"));
		}
	}

	
	async createChart(vault: Vault): Promise<string>{
		const files = vault.getMarkdownFiles();
		const earliestFile = findEarliestDateFile(files)
		let earliestDate = earliestFile.stat.ctime
		if (earliestFile.stat.mtime < earliestFile.stat.ctime ){
			earliestDate = earliestFile.stat.mtime
		}
		
		let monthCounter = 0 //format(new Date(earliestDate), 'MM');
		let dateCount = new Date(earliestDate); // um es hochzählen zu können
		const fileDateMonthMap = new Map<string, number>();
		const fileDateMonthMapMod = new Map<string, number>();
		const monthcount = monthsBetween(new Date(earliestDate), new Date())
		let dateString = dateCount.getMonth()+1 + "." + dateCount.getFullYear()
		let yLabel = ""
		// create Base for counting created
		while (monthCounter < monthcount){
			dateString = dateCount.getMonth()+1 + "." + dateCount.getFullYear()
			//console.log(`dateString: ${dateString}`)
			yLabel = yLabel + dateString + ", "
			dateCount.setMonth(dateCount.getMonth() + 1)
			monthCounter += 1;
			fileDateMonthMap.set(dateString, 0)
		}
		yLabel = yLabel.slice(0,yLabel.length-2)
	
		monthCounter = 0
		dateCount = new Date(earliestDate); // um es hochzählen zu können
		dateString = dateCount.getMonth()+1 + "." + dateCount.getFullYear()
		// create Base for counting modified
		while (monthCounter < monthcount){
			dateString = dateCount.getMonth()+1 + "." + dateCount.getFullYear()
			//console.log(`dateString: ${dateString}`)
			dateCount.setMonth(dateCount.getMonth() + 1)
			monthCounter += 1;
			fileDateMonthMapMod.set(dateString, 0)
		}
	
		// count how many files in each month
		const creationDates = getCreationDates(files)
		for (let i = 0; i < creationDates.length; i++){
			//fileDateMonthMap.set(format(creationDates[i], 'M.yyyy'),fileDateMonthMap.get(format(creationDates[i], 'M.yyyy'))+1)
			const formattedDate = format(creationDates[i], 'M.yyyy');
			const currentCount = fileDateMonthMap.get(formattedDate);

			if (currentCount !== undefined) {
				fileDateMonthMap.set(formattedDate, currentCount + 1);
			} else {
				// If the key doesn't exist in the map, initialize it with a count of 1
				fileDateMonthMap.set(formattedDate, 1);
			}
		}
		
		// count how many mod files in each month
		const modificationDates = getModificationDates(files)
		for (let i = 0; i < modificationDates.length; i++){
			//fileDateMonthMapMod.set(format(modificationDates[i], 'M.yyyy'),fileDateMonthMapMod.get(format(modificationDates[i], 'M.yyyy'))+1)
			const formattedDate = format(creationDates[i], 'M.yyyy');
			const currentCount = fileDateMonthMapMod.get(formattedDate);

			if (currentCount !== undefined) {
				fileDateMonthMapMod.set(formattedDate, currentCount + 1);
			} else {
				// If the key doesn't exist in the map, initialize it with a count of 1
				fileDateMonthMapMod.set(formattedDate, 1);
			}
		}
	
	
	/*
		// count each file only ones, if it got modified in same month shall not counted as created too
		const creationDates = getCreationDates(files)
		const modificationDates = getModificationDates(files)
		console.log(`modificationDates.length: ${modificationDates.length}\tcreationDates.length: ${creationDates.length}`)
		for (let i = 0; i < creationDates.length; i++){
			if(fileDateMonthMapMod.get(format(modificationDates[i], 'M.yyyy')) == fileDateMonthMap.get(format(creationDates[i], 'M.yyyy'))){
				fileDateMonthMap.set(format(creationDates[i], 'M.yyyy'),fileDateMonthMap.get(format(creationDates[i], 'M.yyyy'))+1)
			} //else {
				//fileDateMonthMapMod.set(format(modificationDates[i], 'M.yyyy'),fileDateMonthMapMod.get(format(modificationDates[i], 'M.yyyy'))+1)
			//}
		}
	*/
	
		// build Chart String created
		let charStringCreated = ""
		for (const [key, value] of fileDateMonthMap) {
			//console.log(`key: ${key}, value: ${value}`);
			charStringCreated = charStringCreated + value + ", "
		}
		charStringCreated = charStringCreated.slice(0,charStringCreated.length-2)
		//console.log(`charStringCreated: ${charStringCreated}`);
	
	
		// build Chart String modified
		let charStringModified = ""
		for (const [key, value] of fileDateMonthMapMod) {
			//console.log(`key: ${key}, value: ${value}`);
			charStringModified = charStringModified + value + ", "
		}
		charStringModified = charStringModified.slice(0,charStringModified.length-2)
		//console.log(`charStringModified: ${charStringModified}`);
	
	
		// create chart
		const chartString = createChartFormat(yLabel, charStringCreated, charStringModified, this.settings.chartReduzierungMonate)
		//console.log(`chartString: ${chartString}`);
		return chartString
	}

	async decisionIfBadge(newLevel: Promise<boolean>){
		newLevel.then((result: boolean)=> {
			if(result){
				const badge : Badge = getBadgeForLevel(this.settings.statusLevel, false)
				new Notice(`You've earned the "${badge.name}" badge. ${badge.description}`)
				console.log(`You've earned the "${badge.name}" badge. ${badge.description}`)
				//console.log(`badge for level ${this.settings.statusLevel} is ${badge.name} - ${badge.level}`)
				this.giveBadgeInProfile(this.settings.avatarPageName, badge)
				this.settings.badgeBoosterState = false;
				this.settings.badgeBoosterFactor = 1;
				this.saveData(this.settings)
			}
		});
	}

	
	async removeKeysFromFrontmatter() {
		//const { Vault, TFile } = window.app;
		const { vault } = this.app
		//const vault = Vault.reopen();
		
		// Get all Markdown files in the vault
		//const markdownFiles = vault.getMarkdownFiles();
		const fileCountMap = await getFileCountMap(this.app, this.settings.tagsExclude, this.settings.folderExclude);
		for (const fileName of fileCountMap.keys()) {
			const files = vault.getFiles();
			const file = files.find(file => file.basename === fileName);
			if (!file) {
				console.warn(`File ${fileName} not found.`);
			continue;
			}
			//const fileContents = await app.vault.read(file);
			console.log(`Processing file ${fileName}`);
			try {
				await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
					delete frontmatter['title-class']
					delete frontmatter['note-length-class']
					delete frontmatter['inlink-class']
					delete frontmatter['outlink-class']
					delete frontmatter['progressive-sumarization-maturity']
					delete frontmatter['note-maturity']
				});
			} catch (e) {
				if (e?.name === 'YAMLParseError') {
					const errorMessage = `Update majuritys failed Malformed frontamtter ${e.message}`;
					new Notice(errorMessage, 4000);
					console.error(errorMessage);
				}
		  	}
			// new Notice(`Removed specified keys from frontmatter from file \"${fileName}\".`);
	  	}
	}

	async whichLevelNextBadge(currentLevel: number): Promise<number>{
		let nextBadgeLevel: number = 0
		for (let i = currentLevel; i < 110; i++){
			const badge : Badge = getBadgeForLevel(i, true)
			// Regular expression to match the level number
			const levelRegex = /level (\d+)/;
			// Extract the level number using the regular expression
			const match = badge.level.match(levelRegex);
			if(match){
				const levelNumber = parseInt(match[1], 10); // Convert the matched number to an integer
				if (levelNumber > currentLevel && nextBadgeLevel == 0 ) {
					nextBadgeLevel = levelNumber;
				}
			} 	
		}
		return nextBadgeLevel
	}

	async boosterForInit(): Promise<number> {
		const nextBadgeAt = await this.whichLevelNextBadge(this.settings.statusLevel)
		const statusPointsToReach = statusPointsForLevel(nextBadgeAt)
		//console.log(`statusPointsToReach for next Badge: ${statusPointsToReach}`)
		// 50 Notes from Level 1 to 5 to get the first badge.
		// 300 Points in average for a Note.
		const boosterFactor = Math.round((statusPointsToReach - this.settings.statusPoints)/50/300);
		this.settings.badgeBoosterFactor = boosterFactor
		this.settings.badgeBoosterState = true
		this.saveData(this.settings)
		//console.log(`boosterFaktor: ${boosterFactor}`) 
		return boosterFactor
	}

	async openAvatarFile() {
		const existingFile = app.vault.getAbstractFileByPath(`${this.settings.avatarPageName}.md`);
		if (existingFile){ // && "open" in existingFile) {
			const sourcePath = this.app.workspace.getActiveFile()?.path || '';
			app.workspace.openLinkText(existingFile.path, sourcePath);
		} else {
			console.log("File not found or unable to open.");
		}
	}

	async dailyChallengeUpdateProfile(avatarPageName: string, createdNotes: number){
		const existingFile = app.vault.getAbstractFileByPath(`${avatarPageName}.md`);
		if (existingFile == null) {
			console.log(`File ${avatarPageName}.md does not exist`);
			return;
			}
		const file = existingFile as TFile;

		const content = await app.vault.read(file);
		let reference: number | null = null;
		let end: number | null = null;
		let start: number | null = null;

		const newString = '| daily Notes     |  ' + createdNotes + '/2   |'
		
		const lines = content.split("\n");
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();
			if (line === "^dailyNotesChallenge") {
				if (reference === null) {
					reference = i;
				}
			}		
		}
		if (reference != null ){
			start = reference - 1;
			end = reference;
			const newLines = [...lines.slice(0, start), newString, ...lines.slice(end)];
			await app.vault.modify(file, newLines.join("\n"));
		}
	}
}	  


function isSameDay(inputDate: Moment): boolean {
    const currentDate = window.moment(); // Get the current date
	return currentDate.isSame(inputDate, 'day'); // Check if they are the same day
}

function isOneDayBefore(inputDate: Moment): boolean {
    const currentDate = window.moment(); // Get the current date
    const oneDayBeforeCurrent = window.moment().subtract(1, 'day'); // Calculate one day before current date
    return inputDate.isSame(oneDayBeforeCurrent, 'day'); 
}


async function createAvatarFile(app: App, fileName: string): Promise<void> {
	//settings: GamificationPluginSettings;
	// Define the file name and content
	//const fileName = 'Avatar - Gamification'; // this.settings.avatarPageName;
	//console.log(`fileName: ${fileName}`)
	const fileContent = `# Avatar

|        |     |
| ------ | --- |
| Level  | 0    |
| Points | 0    |
^levelAndPoints	
\`\`\`chart
type: bar
labels: [Expririence]
series:
  - title: points reached
    data: [0]
  - title: points to earn to level up
    data: [1000]
xMin: 0
xMax: 1000
tension: 0.2
width: 40%
labelColors: false
fill: false
beginAtZero: false
bestFit: false
bestFitTitle: undefined
bestFitNumber: 0
stacked: true
indexAxis: y
xTitle: "progress"
legend: false
\`\`\`

|             |     |       |
| ----------- | --- | ----- |
| **daily Notes** | *500EP* | **0/2** |
^dailyNotesChallenge
|  |     ||
| ---- | --- | --- |
| **weekly Notes** | *2000EP*     |  **0/7**   |
^weeklyNotesChallenge
\`\`\`chart
type: bar
labels: [Notes]
series:
  - title: days done in a row
    data: [0]
  - title: days to do in a row
    data: [7]
xMin: 0
xMax: 7
tension: 0.2
width: 40%
labelColors: false
fill: false
beginAtZero: false
bestFit: false
bestFitTitle: undefined
bestFitNumber: 0
stacked: true
indexAxis: y
xTitle: "days"
legend: false
\`\`\`

| Level | Count |
| :---: | :---: |
| Majurity 5 |\`$=dv.pages().where(p => [5, '5', '5➡️', '5⬇️', '5⬆️'].includes(p.file.frontmatter['note-maturity'])).length\`|
| Majurity 4 |\`$=dv.pages().where(p => [4, '4', '4➡️', '4⬇️', '4⬆️'].includes(p.file.frontmatter['note-maturity'])).length\`|
| Majurity 3 |\`$=dv.pages().where(p => [3, '3', '3➡️', '3⬇️', '3⬆️'].includes(p.file.frontmatter['note-maturity'])).length\`|
| Majurity 2 |\`$=dv.pages().where(p => [2, '2', '2➡️', '2⬇️', '2⬆️'].includes(p.file.frontmatter['note-maturity'])).length\`|
| Majurity 1 |\`$=dv.pages().where(p => [1, '1', '1➡️', '1⬇️', '1⬆️'].includes(p.file.frontmatter['note-maturity'])).length\`|
| Majurity 0 |\`$=dv.pages().where(p => [0, '0', '0➡️', '0⬇️', '0⬆️'].includes(p.file.frontmatter['note-maturity'])).length\`|


\`\`\`chart
type: bar
labels: [0, 0, 0]
series:
  - title: created
    data: [0, 0, 0]
  - title: modified
    data: [0, 0, 0]
tension: 0.2
width: 80 %
labelColors: false
fill: false
beginAtZero: false
bestFit: false
bestFitTitle: undefined
bestFitNumber: 0
stacked: true
yTitle: "Number of Notes"
xTitle: "Months"
xMin: 0
\`\`\`
^ChartMonth


### Badges
#### achieved


#### outstanding
level 5: *Enlightened Novice*
level 10: *Curious Connoisseur*
level 20: *Brainiac Trailblazer*
level 27: *Scholarly Trailblazer*
level 35: *Info Ninja Master*
level 42: *Wise Owl Guru*
level 50: *Einstein Incarnate*
level 60: *Mastermind Sage*
level 75: *Cerebral Maestro*
level 82: *Zen Knowledge Keeper*
level 90: *Grand Archivist Overlord*
level 100: *Omniscient Sage of Everything*



### **note-maturity = 5**
\`\`\`dataview
List NoteMaturityCount
from ""
Where note-maturity = 5 or note-maturity = "5" or note-maturity = "5➡️" or note-maturity = "5⬆️" or note-maturity = "5⬇️"
\`\`\`

### **note-maturity = 4**
\`\`\`dataview
List NoteMaturityCount
from ""
Where note-maturity = 4 or note-maturity = "4" or note-maturity = "4➡️" or note-maturity = "4⬆️" or note-maturity = "4⬇️"
\`\`\`

### note-maturity = 3
\`\`\`dataview
List NoteMaturityCount
from ""
Where note-maturity = 3 or note-maturity = "3" or note-maturity = "3➡️" or note-maturity = "3⬆️" or note-maturity = "3⬇️"
\`\`\`

### note-maturity = 2
\`\`\`dataview
List NoteMaturityCount
from ""
Where note-maturity = 2 or note-maturity = "2" or note-maturity = "2➡️" or note-maturity = "2⬆️" or note-maturity = "2⬇️"
\`\`\`

### note-maturity = 1
\`\`\`dataview
List NoteMaturityCount
from ""
Where note-maturity = 1 or note-maturity = "1" or note-maturity = "1➡️" or note-maturity = "1⬆️" or note-maturity = "1⬇️"
\`\`\`

### note-maturity = 0
\`\`\`dataview
List NoteMaturityCount
from ""
Where note-maturity = 0 or note-maturity = "0" or note-maturity = "0➡️" or note-maturity = "0⬆️" or note-maturity = "0⬇️"
\`\`\`
`;

	const existingFile = app.vault.getAbstractFileByPath(`${fileName}.md`);
	if (existingFile instanceof TFile) {
		console.log(`File ${fileName}.md already exists`);
		return;
	}
	// Create the file in the root of the vault
	const file: TFile = await app.vault.create(`${fileName}.md`, fileContent);
	

}


class ModalInformationbox extends Modal {
    private displayText: string; // Store the text to be displayed

    constructor(app: App, displayText: string) {
        super(app);
        this.displayText = displayText; // Store the passed text
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.setText(this.displayText); // Use the stored text
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}


async function replaceFormatStrings(layer2: string, layer3: string) {
	const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
  
	if (!activeView) {
	  console.error("No active Markdown view found.");
	  return;
	}
  
	const editor = activeView.editor;
	const selectedText = editor.getSelection();
  
	if (!selectedText) {
	  console.error("No text selected (for progressive summarization switch Layer 2 & 3).");
	  return;
	}
  
	var replacedText = selectedText.replaceAll(layer2, "§§§§");
	replacedText = replacedText.replaceAll(layer3, "€€€€")
	replacedText = replacedText.replaceAll("€€€€", layer2)
	replacedText = replacedText.replaceAll("§§§§", layer3)
	
	editor.replaceSelection(replacedText);
}
  
function rateDirectionForStatusPoints(ratingCurrent: string, ratingNew: number): number {
	let ratingFaktor = 0
	//console.log(`ratingCurrent: ${parseInt(ratingCurrent, 10)}`)
	if (parseInt(ratingCurrent, 10) < ratingNew){
		ratingFaktor = ratingNew - parseInt(ratingCurrent, 10)
		//console.log(`ratingFaktor: ${ratingFaktor}\t ratingNew: ${ratingNew}\tratingcurrent: ${ratingCurrent}`)
	} else {
		ratingFaktor = 0
	}

	return ratingFaktor
}



  
  




