import { Theme } from './type';
import theme_light from './light';

const theme: Theme = {
	...theme_light,

	backgroundColor: '#eef3ea',
	backgroundColorTransparent: 'rgba(238, 243, 234, 0.9)',
	oddBackgroundColor: '#e4ebe1',
	color: '#1f2621',
	colorError: '#ff4b4b',
	colorCorrect: '#1cc24b',
	colorWarn: '#e6ff57',
	colorWarnUrl: '#30b3ff',
	colorFaded: '#667566',
	dividerColor: 'rgba(32, 48, 34, 0.14)',
	selectedColor: 'rgba(28, 194, 75, 0.12)',
	urlColor: '#30b3ff',

	backgroundColor2: 'rgba(228, 235, 225, 0.86)',
	backgroundColorTransparent2: 'rgba(32, 48, 34, 0.16)',
	color2: '#1f2621',
	selectedColor2: 'rgba(36, 246, 217, 0.18)',
	colorError2: '#ff4b4b',
	colorWarn2: '#a09f00',
	colorWarn3: '#a09f00',

	backgroundColor3: 'rgba(218, 225, 215, 0.82)',
	backgroundColorHover3: 'rgba(36, 246, 217, 0.14)',
	color3: '#5c6a5e',

	backgroundColor4: 'rgba(238, 243, 234, 0.9)',
	color4: '#1cc24b',
	backgroundColor5: 'rgba(218, 225, 215, 0.92)',
	color5: '#24f6d9',

	raisedBackgroundColor: 'rgba(228, 235, 225, 0.9)',
	raisedColor: '#203022',
	searchMarkerBackgroundColor: '#e6ff57',
	searchMarkerColor: '#203022',

	warningBackgroundColor: 'rgba(217, 229, 176, 0.92)',
	destructiveColor: '#ff4b4b',

	tableBackgroundColor: 'rgba(228, 235, 225, 0.92)',
	codeBackgroundColor: 'rgba(228, 235, 225, 0.96)',
	codeBorderColor: 'rgba(32, 48, 34, 0.1)',
	codeColor: '#1cc24b',

	blockQuoteOpacity: 0.7,

	codeMirrorTheme: 'default',
	codeThemeCss: 'atom-one-light.css',

	highlightedColor: '#203022',
	headerBackgroundColor: '#e4ebe1',
	textSelectionColor: '#24f6d9',
	colorBright2: '#203022',
};

export default theme;
