/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

/* exported init */

const GETTEXT_DOMAIN = 'tlp-battery-care-widget';

const Lang = imports.lang;
const Mainloop = imports.mainloop;

const ByteArray = imports.byteArray;
const {
    GObject,
    St,
    GLib,
    Clutter,
    Gio
} = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Slider = imports.ui.slider;

const _ = ExtensionUtils.gettext;

const Indicator = GObject.registerClass(
    class Indicator extends PanelMenu.Button {
        _init() {
            super._init(0.5, _('TLP'));

            this.getTLPStatus();

            let box = new St.BoxLayout();

            let labelsBox = new St.BoxLayout();
            labelsBox.set_vertical(true);

            this.icon = new St.Icon({
                icon_name: this.getIconName(),
                style_class: 'system-status-icon',
            });
            box.add(this.icon);

            this.indicatorLabel = new St.Label({
                text: this.getIndicatorText(),
                y_align: Clutter.ActorAlign.CENTER
            });
            box.add(this.indicatorLabel);

            this.add_child(box);

            this.refreshTimer();

            this.startChargingThresholdSlider = new Slider.Slider(0.6);
            this.endChargingThresholdSlider = new Slider.Slider(0.8);
            let sliderMenuItem = new PopupMenu.PopupBaseMenuItem({
                activate: false
            });
            sliderMenuItem.add_child(this.startChargingThresholdSlider);
            this.menu.addMenuItem(sliderMenuItem);
            sliderMenuItem = new PopupMenu.PopupBaseMenuItem({
                activate: false
            });
            sliderMenuItem.add_child(this.endChargingThresholdSlider);
            this.menu.addMenuItem(sliderMenuItem);

            this.startChargingThresholdSlider.connect('notify::value', this.sliderChanged.bind(this));
            this.endChargingThresholdSlider.connect('notify::value', this.sliderChanged.bind(this));

            let modeLabel = new St.Label({
                text: `TLP Mode: ${this.status["Mode"]}`,
                y_align: Clutter.ActorAlign.CENTER
            });
            // this.menu.addMenuItem(powerSourceLabel);

            this.setChargeThresholdMenuItem = new PopupMenu.PopupMenuItem("Set Charge Threshold: 60% -> 80%");
            this.setChargeThresholdMenuItem.connect('activate', () => {
                let startVal = ~~(this.startChargingThresholdSlider.value * 100);
                let endVal = ~~(this.endChargingThresholdSlider.value * 100);
                if (startVal >= endVal) {
                    Main.notify("ERROR", "Unable to set charge threshold: starting threshold is greater than stopping threshold.");
                    this.startChargingThresholdSlider.set_value((endVal - 1) / 100);
                    return;
                }
                this.runCommandElevated(['/bin/bash', '-c', `pkexec tlp setcharge ${startVal} ${endVal} BAT0`]);
                Main.notify("TLP Battery Care", "Charge threshold set.");
            });
            this.menu.addMenuItem(this.setChargeThresholdMenuItem);

            let chargeFullyMenuItem = new PopupMenu.PopupMenuItem("Charge Fully");
            chargeFullyMenuItem.connect('activate', () => {
                this.runCommandElevated(['/bin/bash', '-c', 'pkexec tlp fullcharge']);
                Main.notify("TLP Battery Care", "Battery is set to fully charge.");
            });
            this.menu.addMenuItem(chargeFullyMenuItem);
        }

        runCommandElevated(command) {
            try {
                let proc = Gio.Subprocess.new(
                    command,
                    Gio.SubprocessFlags.STDERR_PIPE
                );
            } catch (e) {
                logError(e);
            }
        }

        getTLPStatus() {
            let [, out, , ] = GLib.spawn_command_line_sync("tlp-stat -s");
            const [, status] = ByteArray.toString(out).split('+++ TLP Status');
            const lines = status.split(/\r?\n/);
            let status_dict = {};
            for (var i = 0; i < lines.length; i++) {
                if (!lines[i].includes('=')) {
                    continue;
                }
                let [k, v] = lines[i].trim().split("=");
                status_dict[k.trim()] = v.trim();
            }

            let [, out2, , ] = GLib.spawn_command_line_sync("cat /sys/class/power_supply/BAT0/status");
            status_dict['Battery Status'] = ByteArray.toString(out2)
                .trim()
                .toLowerCase()
                .split(' ')
                .map((s) => s.charAt(0).toUpperCase() + s.substring(1))
                .join(' ');
            this.status = status_dict;
        }

        getIconName() {
            let iconName = 'battery-symbolic';
            if (this.status['Battery Status'] == 'Charging') {
                iconName = 'battery-good-charging-symbolic';
            } else if (this.status['Battery Status'] == 'Not Charging') {
                iconName = 'ac-adapter-symbolic';
            }
            return iconName;
        }

        getIndicatorText() {
            return `${this.status["Power source"].toUpperCase()} | ${this.status["Battery Status"]}`;
        }

        refreshTimer() {
            Mainloop.timeout_add_seconds(1, this.refreshTimer.bind(this));

            this.getTLPStatus();

            this.icon.set_icon_name(this.getIconName());
            this.indicatorLabel.set_text(this.getIndicatorText());
        }

        sliderChanged() {
            this.setChargeThresholdMenuItem.label.set_text(`Set Charge Threshold: ${~~(this.startChargingThresholdSlider.value * 100)}% -> ${~~(this.endChargingThresholdSlider.value * 100)}%`)
        }
    });

class Extension {
    constructor(uuid) {
        this._uuid = uuid;

        ExtensionUtils.initTranslations(GETTEXT_DOMAIN);
    }

    enable() {
        this._indicator = new Indicator();
        Main.panel.addToStatusArea(this._uuid, this._indicator);
    }

    disable() {
        this._indicator.destroy();
        this._indicator = null;
    }
}

function init(meta) {
    return new Extension(meta.uuid);
}
