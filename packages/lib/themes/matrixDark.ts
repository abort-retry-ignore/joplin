import { Theme } from './type';
import theme_dark from './dark';

const theme: Theme = {
	...theme_dark,

	backgroundColor: '#0a0e0a',
	backgroundColorTransparent: 'rgba(10, 14, 10, 0.9)',
	oddBackgroundColor: 'rgba(14, 19, 13, 0.92)',
	color: '#f4fff7',
	colorError: '#ff4b4b',
	colorCorrect: '#62ff94',
	colorWarn: '#e6ff57',
	colorWarnUrl: '#30b3ff',
	colorFaded: '#a7b6ab',
	dividerColor: 'rgba(98, 255, 148, 0.12)',
	selectedColor: 'rgba(46, 255, 106, 0.12)',
	urlColor: '#30b3ff',

	backgroundColor2: 'rgba(12, 18, 12, 0.84)',
	backgroundColorTransparent2: 'rgba(6, 10, 7, 0.72)',
	color2: '#f7fffa',
	selectedColor2: 'rgba(36, 246, 217, 0.16)',
	colorError2: '#ff4b4b',
	colorWarn2: '#e6ff57',
	colorWarn3: '#e6ff57',

	backgroundColor3: 'rgba(20, 28, 18, 0.78)',
	backgroundColorHover3: 'rgba(36, 246, 217, 0.14)',
	color3: '#c9d6cd',

	backgroundColor4: 'rgba(12, 18, 12, 0.88)',
	color4: '#2eff6a',
	backgroundColor5: 'rgba(20, 28, 18, 0.9)',
	color5: '#00efff',

	raisedBackgroundColor: 'rgba(22, 31, 20, 0.88)',
	raisedColor: '#f7fffa',
	searchMarkerBackgroundColor: '#e6ff57',
	searchMarkerColor: '#0a0e0a',

	warningBackgroundColor: 'rgba(30, 42, 27, 0.92)',
	destructiveColor: '#ff4b4b',

	tableBackgroundColor: 'rgba(14, 19, 13, 0.9)',
	codeBackgroundColor: 'rgba(14, 19, 13, 0.92)',
	codeBorderColor: 'rgba(98, 255, 148, 0.16)',
	codeColor: '#1cc24b',

	blockQuoteOpacity: 0.7,

	codeMirrorTheme: 'material-darker',
	codeThemeCss: 'atom-one-dark-reasonable.css',

	highlightedColor: '#ffffff',
	headerBackgroundColor: 'rgba(12, 18, 12, 0.86)',
	textSelectionColor: '#24f6d9',
	colorBright2: '#ffffff',
};

export default theme;
